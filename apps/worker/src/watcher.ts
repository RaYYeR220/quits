import { and, eq, inArray } from 'drizzle-orm';
import { debts, members, users } from '@quits/db';
import type { Quits } from '@quits/service';

export interface ObservedTx {
  digest: string;
  /** USDC balance changes in base units, by address. */
  changes: { address: string; amount: bigint }[];
}

/**
 * Matches an on-chain USDC transfer to an open debt: the debtor's balance went
 * down by exactly the debt and the creditor's went up by exactly the debt.
 * Payments Quits settled itself are already marked and are skipped.
 */
export async function matchExternalPayment(q: Quits, tx: ObservedTx): Promise<{ debtId: string } | null> {
  const down = tx.changes.filter((c) => c.amount < 0n);
  const up = tx.changes.filter((c) => c.amount > 0n);
  if (!down.length || !up.length) return null;

  const addresses = [...new Set(tx.changes.map((c) => c.address))];
  const people = await q.ctx.db
    .select({ id: users.id, address: users.suiAddress, groupId: members.groupId })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(inArray(users.suiAddress, addresses));
  if (people.length < 2) return null;

  for (const from of down) {
    for (const to of up) {
      if (from.address === to.address || -from.amount !== to.amount) continue;
      const debtorIds = people.filter((p) => p.address === from.address);
      const creditorIds = people.filter((p) => p.address === to.address);
      for (const dbt of debtorIds) {
        for (const cr of creditorIds.filter((c) => c.groupId === dbt.groupId)) {
          const [open] = await q.ctx.db
            .select()
            .from(debts)
            .where(
              and(
                eq(debts.groupId, dbt.groupId),
                eq(debts.debtorId, dbt.id),
                eq(debts.creditorId, cr.id),
                eq(debts.usdcMicro, to.amount),
                inArray(debts.status, ['open', 'recorded']),
              ),
            )
            .limit(1);
          if (!open) continue;
          const [used] = await q.ctx.db.select({ id: debts.id }).from(debts).where(eq(debts.txDigest, tx.digest)).limit(1);
          if (used) return null;
          await q.markPaid(open.id, { method: 'external', digest: tx.digest });
          return { debtId: open.id };
        }
      }
    }
  }
  return null;
}

/** USDC changes of a transaction as reported by the node. */
export function usdcChanges(balanceChanges: { address?: string; coinType?: string; amount?: string }[] | undefined, usdcType: string): ObservedTx['changes'] {
  const norm = (t: string) => t.replace(/^0x0*/, '0x');
  return (balanceChanges ?? [])
    .filter((b) => b.address && b.amount && b.coinType && norm(b.coinType) === norm(usdcType))
    .map((b) => ({ address: b.address!, amount: BigInt(b.amount!) }));
}
