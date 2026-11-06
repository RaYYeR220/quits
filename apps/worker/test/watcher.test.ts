import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { memoryDb, users } from '@quits/db';
import { createMockStore } from '@quits/memory';
import { createQuits } from '@quits/service';
import { matchExternalPayment, usdcChanges } from '../src/watcher.ts';

const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

async function world() {
  const q = createQuits({
    db: await memoryDb(),
    memory: createMockStore(),
    llm: { raw: async () => ({ content: '{}', usage: { prompt: 0, completion: 0 } }) },
    fx: { usdcPerFiat: async () => ({ rate: '1', source: 'test', at: '' }) },
  });
  for (const [id, addr] of [['ana', '0xa1'], ['ben', '0xb2'], ['eve', '0xe5']] as const) {
    await q.ensureUser({ id, name: id, authProvider: 'demo' });
    await q.ctx.db.update(users).set({ suiAddress: addr }).where(eq(users.id, id));
  }
  const g = await q.createGroup({ id: 'g', name: 'G', defaultCurrency: 'USD', ownerId: 'ben' });
  await q.addMember(g, 'ana');
  const r = await q.addExpense(g, 'ben', { payerId: 'ben', currency: 'USD', amountMinor: 1000n, category: 'dinner', description: 'pizza', items: [], participants: ['ana', 'ben'], occurredAt: '2026-11-06T12:00:00Z' });
  if (!r.ok) throw new Error('add');
  await q.accept(r.proposal.draftId, 'ben');
  const [debt] = await q.refreshDebts(g);
  return { q, debt: debt! };
}

describe('external payment watcher', () => {
  it('matches a direct transfer of exactly the debt between the two members', async () => {
    const { q, debt } = await world();
    expect(debt.usdcMicro).toBe(5_000_000n);
    const hit = await matchExternalPayment(q, { digest: 'D1', changes: [{ address: '0xa1', amount: -5_000_000n }, { address: '0xb2', amount: 5_000_000n }] });
    expect(hit).toEqual({ debtId: debt.id });
    expect((await q.debt(debt.id)).status).toBe('settled_external');
  });

  it('ignores other amounts, strangers and a digest it already used', async () => {
    const { q, debt } = await world();
    expect(await matchExternalPayment(q, { digest: 'D2', changes: [{ address: '0xa1', amount: -4_000_000n }, { address: '0xb2', amount: 4_000_000n }] })).toBeNull();
    expect(await matchExternalPayment(q, { digest: 'D3', changes: [{ address: '0xe5', amount: -5_000_000n }, { address: '0xb2', amount: 5_000_000n }] })).toBeNull();
    await q.markPaid(debt.id, { method: 'wallet', digest: 'D4' });
    expect(await matchExternalPayment(q, { digest: 'D4', changes: [{ address: '0xa1', amount: -5_000_000n }, { address: '0xb2', amount: 5_000_000n }] })).toBeNull();
  });

  it('keeps only USDC changes', () => {
    expect(usdcChanges([{ address: '0xa', coinType: USDC, amount: '-5' }, { address: '0xa', coinType: '0x2::sui::SUI', amount: '-9' }], USDC)).toEqual([{ address: '0xa', amount: -5n }]);
  });
});
