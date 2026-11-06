import { describe, expect, it } from 'vitest';
import { parseUsdc as u } from '@quits/core';
import { mandates } from '@quits/db';
import { limitFrom } from '../src/index.ts';
import { dinnerParse, setup } from './helpers.ts';

async function postedDinner() {
  const s = await setup();
  s.llm.push(dinnerParse);
  const r = await s.q.addExpenseFromText(s.groupId, 'clara', '84 dinner');
  if (!r.ok) throw new Error('parse');
  await s.q.accept(r.proposal.draftId, 'clara');
  return s;
}

describe('debts', () => {
  it('turns balances into one debt per pair', async () => {
    const { q, groupId } = await postedDinner();
    const d = await q.refreshDebts(groupId);
    expect(d.map((x) => [x.debtorId, x.creditorId, x.usdcMicro]).sort()).toEqual([
      ['ana', 'clara', u('26.25')],
      ['ben', 'clara', u('26.25')],
      ['dan', 'clara', u('26.25')],
    ]);
    expect(await q.refreshDebts(groupId)).toHaveLength(3);
  });

  it('marking the same payment twice is a no-op', async () => {
    const { q, groupId } = await postedDinner();
    const [d] = (await q.refreshDebts(groupId)).filter((x) => x.debtorId === 'ana');
    const first = await q.markPaid(d!.id, { method: 'wallet', digest: 'DIGEST1' });
    const again = await q.markPaid(d!.id, { method: 'external', digest: 'DIGEST1' });
    expect(first.already).toBe(false);
    expect(again.already).toBe(true);
    expect(again.debt.status).toBe('settled_wallet');
    expect((await q.balances(groupId)).ana).toBe(0n);
  });

  it('refuses one transaction for two debts', async () => {
    const { q, groupId } = await postedDinner();
    const ds = await q.refreshDebts(groupId);
    await q.markPaid(ds[0]!.id, { method: 'wallet', digest: 'D' });
    await expect(q.markPaid(ds[1]!.id, { method: 'wallet', digest: 'D' })).rejects.toThrow(/already used/);
  });
});

describe('learned auto-pay limit', () => {
  it('grows with approvals and drops after an objection', () => {
    expect(limitFrom([])).toBe(u('5'));
    expect(limitFrom([{ decision: 'approve', usdcMicro: u('12') }])).toBe(u('12'));
    expect(limitFrom([{ decision: 'approve', usdcMicro: u('12') }, { decision: 'approve', usdcMicro: u('8') }])).toBe(u('12'));
    expect(limitFrom([{ decision: 'approve', usdcMicro: u('12') }, { decision: 'object', usdcMicro: u('10') }])).toBe(u('5'));
  });

  it('asks above the learned limit and records below it', async () => {
    const { q, groupId, db } = await postedDinner();
    await db.insert(mandates).values({
      id: 'm1',
      userId: 'ana',
      groupId,
      allowanceId: '0xallow',
      mandateObjectId: '0xmandate',
      lifetimeCap: u('100'),
      weeklyLimit: u('20'),
      maxPerDebt: u('50'),
      objectionWindowMs: 0,
      creditors: ['ben', 'clara', 'dan'],
      expiresAt: new Date('2026-12-31'),
      openTx: '0xopen',
    });
    const [d] = (await q.refreshDebts(groupId)).filter((x) => x.debtorId === 'ana');
    expect(await q.autoSettleDecision(d!.id)).toEqual({ decision: 'ask', reason: 'over_learned_limit', limit: u('12.5') });
    await q.decide(d!.id, 'ana', 'approve');
    expect(await q.learnedLimit('ana')).toBe(u('26.25'));
    expect(await q.autoSettleDecision(d!.id)).toMatchObject({ decision: 'record', mandateId: '0xmandate' });
    const [bd] = (await q.refreshDebts(groupId)).filter((x) => x.debtorId === 'ben');
    expect(await q.autoSettleDecision(bd!.id)).toEqual({ decision: 'none', reason: 'no_mandate' });
  });

  it('only the debtor can approve', async () => {
    const { q, groupId } = await postedDinner();
    const [d] = (await q.refreshDebts(groupId)).filter((x) => x.debtorId === 'ana');
    await expect(q.decide(d!.id, 'ben', 'approve')).rejects.toThrow(/debtor/);
  });
});
