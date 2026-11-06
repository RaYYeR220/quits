import { describe, expect, it } from 'vitest';
import { parseUsdc as u } from '@quits/core';
import { createMockStore, type MemoryStore } from '@quits/memory';
import { anaNoAlcohol, dinnerParse, setup } from './helpers.ts';

// 84.00 EUR at 0.8 EUR per USDC = 105.00 USDC; the wine (24.00 EUR) = 30.00 USDC.

describe('the learning loop', () => {
  it('splits the first dinner equally, learns from the correction, and applies it next time', async () => {
    const { q, llm, groupId, clock } = await setup();

    llm.push(dinnerParse);
    const first = await q.addExpenseFromText(groupId, 'clara', '84 € dinner, I paid, 24 of it was wine');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.proposal.expense.usdcMicro).toBe(u('105'));
    expect(first.proposal.shares).toEqual({ ana: u('26.25'), ben: u('26.25'), clara: u('26.25'), dan: u('26.25') });
    expect(first.proposal.why).toEqual([]);

    llm.push(anaNoAlcohol);
    const fixed = await q.correct(first.proposal.draftId, 'ana', 'I don’t drink');
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;
    expect(fixed.learned?.scope).toBe('member');
    expect(fixed.proposal.shares.ana).toBe(u('18.75'));
    expect(fixed.proposal.why[0]?.state).toBe('saving');
    await q.accept(first.proposal.draftId, 'clara');
    await q.flushMemory();

    clock.set('2026-10-19T19:00:00Z');
    llm.push({ ...dinnerParse, description: 'Dinner at Pod Baranami' });
    const next = await q.addExpenseFromText(groupId, 'ben', 'another dinner, Clara paid 84, 24 wine');
    expect(next.ok && next.proposal.shares.ana).toBe(u('18.75'));
    expect(next.ok && next.proposal.why.map((w) => w.state)).toEqual(['stored']);
  });

  it('cites the Walrus blob behind every applied memory', async () => {
    const { q, llm, groupId } = await setup();
    llm.push(dinnerParse, anaNoAlcohol);
    const a = await q.addExpenseFromText(groupId, 'clara', 'x');
    if (!a.ok) throw new Error('parse');
    await q.correct(a.proposal.draftId, 'ana', 'I don’t drink');
    await q.flushMemory();
    llm.push(dinnerParse);
    const b = await q.addExpenseFromText(groupId, 'clara', 'y');
    if (!b.ok) throw new Error('parse');
    expect(b.proposal.why[0]).toMatchObject({ sentence: 'Ana doesn’t drink, so leave her out of alcohol.', state: 'stored', appliesTo: ['wine'] });
    expect(b.proposal.why[0]?.blobId).toBeTruthy();
    expect(b.proposal.memoriesRead).toBeGreaterThan(0);
  });

  it('refuses to price a currency it can’t convert', async () => {
    const { q, llm, groupId } = await setup();
    llm.push({ ...dinnerParse, currency: 'XAF', amount: '5000', items: [] });
    const r = await q.addExpenseFromText(groupId, 'clara', '5000 XAF taxi');
    expect(r).toEqual({ ok: false, fxUnavailable: 'XAF' });
    expect(await q.expenses(groupId, { includeDrafts: true })).toEqual([]);
  });

  it('replays the same expense with day-one knowledge vs today', async () => {
    const { q, llm, groupId, clock } = await setup();
    llm.push(dinnerParse, anaNoAlcohol);
    const a = await q.addExpenseFromText(groupId, 'clara', 'x');
    if (!a.ok) throw new Error('parse');
    await q.correct(a.proposal.draftId, 'ana', 'I don’t drink');
    await q.flushMemory();
    clock.set('2026-11-01T10:00:00Z');
    const dayOne = await q.replay(a.proposal.draftId, '2026-10-12T00:00:00Z');
    const today = await q.replay(a.proposal.draftId, '2026-11-01T10:00:00Z');
    expect(dayOne.shares.ana).toBe(u('26.25'));
    expect(today.shares.ana).toBe(u('18.75'));
  });

  it('rebuilds the rule index from Walrus alone and splits the same way', async () => {
    const { q, llm, groupId } = await setup();
    await q.learnRule({
      groupId,
      scope: 'group',
      sentence: 'Rent splits by room size.',
      rule: { v: 1, id: 'rent', learnedAt: '2026-10-15T09:00:00Z', kind: 'weights', weights: { ana: 40, ben: 20, clara: 20, dan: 20 }, when: { category: ['rent'] } },
    });
    await q.flushMemory();
    const rent = { ...dinnerParse, category: 'rent', amount: '1000', items: [], description: 'Rent' };
    llm.push(rent);
    const before = await q.addExpenseFromText(groupId, 'ana', 'rent 1000');
    const { rules: rulesTable, memories: memTable } = await import('@quits/db');
    // the local index loses its rows (but Walrus still has the memory)
    await q.ctx.db.delete(rulesTable);
    await q.ctx.db.delete(memTable);
    expect(await q.rules(groupId)).toEqual([]);
    expect(await q.rebuildFromWalrus(groupId)).toMatchObject({ rules: 1, complete: true });
    llm.push(rent);
    const after = await q.addExpenseFromText(groupId, 'ana', 'rent 1000');
    expect(before.ok && after.ok && after.proposal.shares).toEqual(before.ok && before.proposal.shares);
    expect(after.ok && after.proposal.shares.ana).toBe(u('500'));
  });

  it('splits equally when memory is switched off (ablation)', async () => {
    const memory = createMockStore();
    const on = await setup({ memory });
    on.llm.push(dinnerParse, anaNoAlcohol);
    const a = await on.q.addExpenseFromText(on.groupId, 'clara', 'x');
    if (!a.ok) throw new Error('parse');
    await on.q.correct(a.proposal.draftId, 'ana', 'I don’t drink');
    await on.q.flushMemory();

    const off = await setup({ memory, memoryEnabled: false });
    off.llm.push(dinnerParse);
    const b = await off.q.addExpenseFromText(off.groupId, 'clara', 'x');
    expect(b.ok && b.proposal.shares.ana).toBe(u('26.25'));
  });

  it('carries a member’s portable rule into a new group', async () => {
    const { q, llm, groupId } = await setup();
    llm.push(dinnerParse, anaNoAlcohol);
    const a = await q.addExpenseFromText(groupId, 'clara', 'x');
    if (!a.ok) throw new Error('parse');
    await q.correct(a.proposal.draftId, 'ana', 'I don’t drink');
    await q.flushMemory();

    const trip = await q.createGroup({ id: 'lisbon', name: 'Lisbon trip', defaultCurrency: 'EUR', ownerId: 'ben' });
    await q.addMember(trip, 'ana');
    llm.push({ ...dinnerParse, payer: 'ben', participants: ['ana', 'ben'] });
    const r = await q.addExpenseFromText(trip, 'ben', 'dinner 84, 24 wine');
    // food 75 USDC split two ways, wine 30 USDC all on Ben
    expect(r.ok && r.proposal.shares).toEqual({ ana: u('37.5'), ben: u('67.5') });
  });

  it('labels the split as cached when Walrus can’t be read', async () => {
    const inner = createMockStore();
    let broken = false;
    const memory: MemoryStore = {
      ...inner,
      kind: inner.kind,
      recall: (...a) => (broken ? Promise.reject(new Error('relayer down')) : inner.recall(...a)),
    };
    const { q, llm, groupId } = await setup({ memory });
    llm.push(dinnerParse, anaNoAlcohol);
    const a = await q.addExpenseFromText(groupId, 'clara', 'x');
    if (!a.ok) throw new Error('parse');
    await q.correct(a.proposal.draftId, 'ana', 'I don’t drink');
    await q.flushMemory();
    broken = true;
    llm.push(dinnerParse);
    const b = await q.addExpenseFromText(groupId, 'clara', 'y');
    expect(b.ok && b.proposal.degraded).toBe('cached');
    expect(b.ok && b.proposal.shares.ana).toBe(u('18.75'));
    expect(b.ok && b.proposal.why[0]?.state).toBe('cached');
  });
});

describe('when Walrus does not return a stored rule', () => {
  it('still applies it from the index and marks it cached', async () => {
    const inner = createMockStore();
    let forget = false;
    const memory: MemoryStore = { ...inner, kind: inner.kind, recall: async (...a) => (forget ? [] : inner.recall(...a)) };
    const { q, llm, groupId } = await setup({ memory });
    llm.push(dinnerParse, anaNoAlcohol);
    const a = await q.addExpenseFromText(groupId, 'clara', 'x');
    if (!a.ok) throw new Error('parse');
    await q.correct(a.proposal.draftId, 'ana', 'I don’t drink');
    await q.flushMemory();
    forget = true;
    llm.push(dinnerParse);
    const b = await q.addExpenseFromText(groupId, 'clara', 'y');
    expect(b.ok && b.proposal.shares.ana).toBe(u('18.75'));
    expect(b.ok && b.proposal.why[0]?.state).toBe('cached');
    expect(b.ok && b.proposal.why[0]?.blobId).toBeTruthy();
  });
});

describe('rebuild safety', () => {
  it('keeps the index when Walrus returns fewer rules than it holds', async () => {
    const inner = createMockStore();
    let blind = false;
    const memory: MemoryStore = { ...inner, kind: inner.kind, recall: async (...a) => (blind ? [] : inner.recall(...a)) };
    const { q, groupId } = await setup({ memory });
    await q.learnRule({
      groupId,
      scope: 'group',
      sentence: 'Ben always covers taxis.',
      rule: { v: 1, id: 'taxi', learnedAt: '2026-10-18T09:00:00Z', kind: 'covers', member: 'ben', when: { category: ['taxi'] } },
    });
    await q.flushMemory();
    blind = true;
    expect(await q.rebuildFromWalrus(groupId)).toEqual({ rules: 0, indexed: 1, complete: false });
    expect((await q.rules(groupId)).map((r) => r.id)).toEqual(['taxi']);
  });
});
