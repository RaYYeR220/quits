import { and, eq, inArray } from 'drizzle-orm';
import { balances, encodeMemory, formatUsdc, settleUp, type Micro } from '@quits/core';
import { debts, expenses, shares } from '@quits/db';
import { nsGroupLog } from '@quits/memory';
import { QuitsError, type Ctx } from './context.ts';
import { groupMembers } from './groups.ts';
import { enqueueMemory } from './memoryQueue.ts';

export type DebtRow = typeof debts.$inferSelect;
const SETTLED = ['settled_wallet', 'settled_agent', 'settled_external'] as const;
const LIVE = ['open', 'recorded'] as const;

export async function groupBalances(ctx: Ctx, groupId: string): Promise<Record<string, Micro>> {
  const posted = await ctx.db.select().from(expenses).where(and(eq(expenses.groupId, groupId), eq(expenses.status, 'posted')));
  const ids = posted.map((p) => p.id);
  const sh = ids.length ? await ctx.db.select().from(shares).where(inArray(shares.expenseId, ids)) : [];
  const byExpense = new Map<string, Record<string, Micro>>();
  for (const s of sh) {
    const m = byExpense.get(s.expenseId) ?? {};
    m[s.memberId] = s.usdcMicro;
    byExpense.set(s.expenseId, m);
  }
  const settled = await ctx.db.select().from(debts).where(and(eq(debts.groupId, groupId), inArray(debts.status, [...SETTLED])));
  const b = balances(
    posted.map((p) => ({ payerId: p.payerId, usdcMicro: p.usdcMicro, shares: byExpense.get(p.id) ?? {} })),
    settled.map((d) => ({ from: d.debtorId, to: d.creditorId, usdcMicro: d.usdcMicro })),
  );
  for (const m of await groupMembers(ctx, groupId)) b[m.id] ??= 0n;
  return b;
}

/**
 * Brings the group's open debts in line with the current balances: one live
 * debt per (debtor, creditor) pair. Open debts change amount freely; debts
 * already recorded on-chain keep their amount (the contract pays exactly that).
 */
export async function refreshDebts(ctx: Ctx, groupId: string): Promise<DebtRow[]> {
  const plan = settleUp(await groupBalances(ctx, groupId));
  const live = await ctx.db.select().from(debts).where(and(eq(debts.groupId, groupId), inArray(debts.status, [...LIVE])));
  const key = (a: string, b: string) => `${a}->${b}`;
  const want = new Map(plan.map((t) => [key(t.from, t.to), t]));

  for (const d of live) {
    const t = want.get(key(d.debtorId, d.creditorId));
    if (d.status === 'recorded') {
      want.delete(key(d.debtorId, d.creditorId));
      continue;
    }
    if (!t) {
      await ctx.db.update(debts).set({ status: 'cancelled' }).where(eq(debts.id, d.id));
    } else {
      if (t.usdcMicro !== d.usdcMicro) await ctx.db.update(debts).set({ usdcMicro: t.usdcMicro }).where(eq(debts.id, d.id));
      want.delete(key(d.debtorId, d.creditorId));
    }
  }
  for (const t of want.values()) {
    await ctx.db.insert(debts).values({ id: ctx.id(), groupId, debtorId: t.from, creditorId: t.to, usdcMicro: t.usdcMicro }).onConflictDoNothing();
  }
  return ctx.db.select().from(debts).where(and(eq(debts.groupId, groupId), inArray(debts.status, [...LIVE])));
}

export async function getDebt(ctx: Ctx, debtId: string): Promise<DebtRow> {
  const [d] = await ctx.db.select().from(debts).where(eq(debts.id, debtId)).limit(1);
  if (!d) throw new QuitsError('not_found', 'debt not found');
  return d;
}

export type PaidMethod = 'wallet' | 'agent' | 'external';

/**
 * Marks a debt paid by a verified on-chain transfer. Idempotent: a second call
 * with the same digest returns the existing row; a digest already used for a
 * different debt is refused.
 */
export async function markPaid(ctx: Ctx, debtId: string, p: { method: PaidMethod; digest: string; amount?: bigint }): Promise<{ debt: DebtRow; already: boolean }> {
  const d = await getDebt(ctx, debtId);
  if ((SETTLED as readonly string[]).includes(d.status)) {
    if (d.txDigest && d.txDigest !== p.digest) throw new QuitsError('conflict', 'debt already settled by another transaction');
    return { debt: d, already: true };
  }
  if (d.status === 'cancelled') throw new QuitsError('conflict', 'debt was cancelled');
  const [clash] = await ctx.db.select({ id: debts.id }).from(debts).where(eq(debts.txDigest, p.digest)).limit(1);
  if (clash) throw new QuitsError('conflict', 'transaction already used for another debt');

  const status = p.method === 'wallet' ? 'settled_wallet' : p.method === 'agent' ? 'settled_agent' : 'settled_external';
  // If a new bill changed this debt while the transfer was in flight, keep the amount that was actually paid;
  // the next refresh opens a debt for whatever is still owed.
  const paid = p.amount ?? d.usdcMicro;
  await ctx.db.update(debts).set({ status, txDigest: p.digest, settledAt: ctx.now(), usdcMicro: paid }).where(eq(debts.id, debtId));
  d.usdcMicro = paid;
  const members = await groupMembers(ctx, d.groupId);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const how = p.method === 'agent' ? 'through their auto-settle mandate' : p.method === 'external' ? 'directly (matched on-chain)' : 'from their wallet';
  await enqueueMemory(ctx, {
    ns: nsGroupLog(d.groupId),
    kind: 'event',
    text: encodeMemory(`${name(d.debtorId)} paid ${name(d.creditorId)} ${formatUsdc(d.usdcMicro)} USDC ${how}.`, {
      kind: 'event',
      event: 'settlement',
      data: { debtId: d.id, from: d.debtorId, to: d.creditorId, usdcMicro: d.usdcMicro.toString(), digest: p.digest, method: p.method },
    }),
  });
  await refreshDebts(ctx, d.groupId);
  return { debt: await getDebt(ctx, debtId), already: false };
}

export async function markRecorded(ctx: Ctx, debtId: string, r: { onchainDebtId: string; mandateId: string; pullableAt: Date }) {
  await ctx.db
    .update(debts)
    .set({ status: 'recorded', onchainDebtId: r.onchainDebtId, mandateId: r.mandateId, pullableAt: r.pullableAt })
    .where(and(eq(debts.id, debtId), eq(debts.status, 'open')));
}

export async function cancelDebt(ctx: Ctx, debtId: string) {
  await ctx.db.update(debts).set({ status: 'cancelled' }).where(and(eq(debts.id, debtId), inArray(debts.status, [...LIVE])));
}
