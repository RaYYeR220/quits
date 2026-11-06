import { describe, expect, it } from 'vitest';
import type { Expense } from '@quits/core';
import { compileCorrection } from '../src/compileCorrection.ts';
import { createLlm } from '../src/client.ts';
import { fakeLlm } from './fake.ts';

const members = [
  { id: 'ana', name: 'Ana' },
  { id: 'ben', name: 'Ben' },
  { id: 'clara', name: 'Clara' },
  { id: 'dan', name: 'Dan' },
];
const expense: Expense = {
  id: 'e1',
  groupId: 'g1',
  payerId: 'clara',
  usdcMicro: 97_440_000n,
  currency: 'EUR',
  amountMinor: 8400n,
  category: 'dinner',
  items: [{ label: 'wine', usdcMicro: 27_840_000n, tags: ['alcohol'] }],
  participants: ['ana', 'ben', 'clara', 'dan'],
  description: 'Dinner at Time Out Market',
  occurredAt: '2026-11-06T19:00:00Z',
};
const ctx = { expense, members, now: '2026-11-06T20:00:00.000Z', newId: () => 'r-new' };

describe('compileCorrection', () => {
  it('turns "Ana doesn’t drink" into a portable exclude rule', async () => {
    const out = {
      status: 'rule',
      scope: 'member',
      sentence: 'Ana doesn’t drink, so leave her out of alcohol.',
      rule: { kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } },
    };
    const r = await compileCorrection(fakeLlm([out]), 'Ana doesn’t drink', ctx);
    expect(r).toEqual({
      ok: true,
      scope: 'member',
      sentence: 'Ana doesn’t drink, so leave her out of alcohol.',
      rule: { v: 1, id: 'r-new', learnedAt: '2026-11-06T20:00:00.000Z', kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } },
    });
  });

  it('keeps group norms in the group', async () => {
    const out = {
      status: 'rule',
      scope: 'member',
      sentence: 'Rent splits by room size.',
      rule: { kind: 'weights', weights: [{ member: 'ana', weight: 40 }, { member: 'ben', weight: 20 }, { member: 'clara', weight: 20 }, { member: 'dan', weight: 20 }], when: { category: ['rent'] } },
    };
    const r = await compileCorrection(fakeLlm([out]), 'rent goes by room size 40/20/20/20', ctx);
    expect(r.ok && 'rule' in r && r.scope).toBe('group');
  });

  it('asks back when the correction is ambiguous', async () => {
    const r = await compileCorrection(fakeLlm([{ status: 'clarify', clarify: 'Who should be left out?' }]), 'that’s wrong', ctx);
    expect(r).toEqual({ ok: false, clarify: 'Who should be left out?' });
  });

  it('asks back instead of inventing a member', async () => {
    const out = { status: 'rule', scope: 'member', sentence: 'Zoe doesn’t drink.', rule: { kind: 'exclude', member: 'zoe', when: { tags: ['alcohol'] } } };
    const r = await compileCorrection(fakeLlm([out]), 'zoe doesn’t drink', ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.clarify).toMatch(/zoe/i);
  });

  it('can revoke an earlier rule', async () => {
    const out = {
      status: 'rule',
      scope: 'member',
      sentence: 'Ana drinks again, include her in alcohol.',
      rule: { kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] }, revoked: true },
    };
    const r = await compileCorrection(fakeLlm([out]), 'Ana drinks now', ctx);
    expect(r.ok && 'rule' in r && r.rule.revoked).toBe(true);
  });

  it('treats a one-off fact as a fix to this expense, not a rule', async () => {
    const r = await compileCorrection(fakeLlm([{ status: 'once', once: { absent: ['dan'] } }]), 'Dan wasn’t there', ctx);
    expect(r).toEqual({ ok: true, once: { absent: ['dan'] } });
  });

  it('asks back about an unknown person in a one-off fix', async () => {
    const r = await compileCorrection(fakeLlm([{ status: 'once', once: { absent: ['zoe'] } }]), 'Zoe wasn’t there', ctx);
    expect(r.ok).toBe(false);
  });

  it('rejects a rule the engine cannot run', async () => {
    const out = { status: 'rule', scope: 'group', sentence: 'x', rule: { kind: 'weights', weights: [], when: {} } };
    const r = await compileCorrection(fakeLlm([out]), 'x', ctx);
    expect(r.ok).toBe(false);
  });
});

describe.skipIf(!process.env.LIVE_LLM)('compileCorrection (live model)', () => {
  it('compiles a real correction', async () => {
    const llm = createLlm({
      apiKey: process.env.LLM_API_KEY ?? '',
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.venice.ai/api/v1',
      model: process.env.LLM_MODEL ?? 'gemini-3-8-flash',
    });
    const r = await compileCorrection(llm, 'Ana doesn’t drink, leave her out of the wine', ctx);
    expect(r.ok).toBe(true);
    if (!r.ok || !('rule' in r)) throw new Error('expected a rule');
    expect(r.rule.kind).toBe('exclude');
    expect(r.rule.kind === 'exclude' && r.rule.member).toBe('ana');
    expect(r.rule.when.tags).toContain('alcohol');
    expect(r.scope).toBe('member');
  }, 60_000);

  it('does not turn a one-off absence into a rule', async () => {
    const llm = createLlm({
      apiKey: process.env.LLM_API_KEY ?? '',
      baseUrl: process.env.LLM_BASE_URL ?? 'https://api.venice.ai/api/v1',
      model: process.env.LLM_MODEL ?? 'gemini-3-8-flash',
    });
    const r = await compileCorrection(llm, 'Dan was not there tonight, leave him out', ctx);
    expect(r).toEqual({ ok: true, once: { absent: ['dan'] } });
  }, 60_000);
});
