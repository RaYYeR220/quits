import { and, asc, eq } from 'drizzle-orm';
import { encodeMemory, formatUsdc, type Micro } from '@quits/core';
import { approvals, debts, mandates, users } from '@quits/db';
import { nsMember } from '@quits/memory';
import { QuitsError, type Ctx } from './context.ts';
import { getDebt } from './debts.ts';
import { enqueueMemory } from './memoryQueue.ts';

/** Where a new member's auto-pay trust starts. */
export const STARTING_LIMIT: Micro = 5_000_000n;

/**
 * The amount up to which a member's agent may pay without asking, learned from
 * their decisions: approving a payment raises the limit to that amount;
 * objecting to one cuts the limit to half of it. Hard bounds stay on-chain.
 */
export function limitFrom(decisions: { decision: 'approve' | 'object'; usdcMicro: Micro }[]): Micro {
  let limit = STARTING_LIMIT;
  for (const d of decisions) {
    if (d.decision === 'approve') limit = d.usdcMicro > limit ? d.usdcMicro : limit;
    else {
      const half = d.usdcMicro / 2n;
      limit = half < limit ? half : limit;
    }
  }
  return limit;
}

export async function learnedLimit(ctx: Ctx, userId: string): Promise<Micro> {
  const rows = await ctx.db
    .select({ decision: approvals.decision, usdcMicro: debts.usdcMicro, at: approvals.createdAt })
    .from(approvals)
    .innerJoin(debts, eq(debts.id, approvals.debtId))
    .where(eq(approvals.userId, userId))
    .orderBy(asc(approvals.createdAt));
  return limitFrom(rows);
}

export async function activeMandate(ctx: Ctx, userId: string, groupId: string) {
  const [m] = await ctx.db
    .select()
    .from(mandates)
    .where(and(eq(mandates.userId, userId), eq(mandates.groupId, groupId), eq(mandates.status, 'active')))
    .limit(1);
  return m;
}

export type Decision =
  | { decision: 'none'; reason: 'no_mandate' | 'creditor_not_listed' | 'not_open' }
  | { decision: 'ask'; reason: 'over_learned_limit' | 'over_mandate_limit'; limit: Micro }
  | { decision: 'record'; limit: Micro; mandateId: string };

/** Whether the debtor's agent may record (and later pull) this debt on its own. */
export async function autoSettleDecision(ctx: Ctx, debtId: string): Promise<Decision> {
  const d = await getDebt(ctx, debtId);
  if (d.status !== 'open') return { decision: 'none', reason: 'not_open' };
  const m = await activeMandate(ctx, d.debtorId, d.groupId);
  if (!m) return { decision: 'none', reason: 'no_mandate' };
  if (!m.creditors.includes(d.creditorId)) return { decision: 'none', reason: 'creditor_not_listed' };
  const limit = await learnedLimit(ctx, d.debtorId);
  const [approved] = await ctx.db
    .select()
    .from(approvals)
    .where(and(eq(approvals.debtId, d.id), eq(approvals.decision, 'approve')))
    .limit(1);
  if (d.usdcMicro > m.maxPerDebt) return { decision: 'ask', reason: 'over_mandate_limit', limit };
  if (d.usdcMicro > limit && !approved) return { decision: 'ask', reason: 'over_learned_limit', limit };
  return { decision: 'record', limit, mandateId: m.mandateObjectId };
}

/** The debtor approves or objects to an auto-payment. Either way Quits learns from it. */
export async function decide(ctx: Ctx, debtId: string, userId: string, decision: 'approve' | 'object'): Promise<{ limit: Micro }> {
  const d = await getDebt(ctx, debtId);
  if (d.debtorId !== userId) throw new QuitsError('forbidden', 'only the debtor decides');
  const before = await learnedLimit(ctx, userId);
  await ctx.db.insert(approvals).values({ id: ctx.id(), debtId, userId, decision });
  const limit = await learnedLimit(ctx, userId);
  if (limit !== before) {
    const sentence =
      decision === 'approve'
        ? `Auto-pay is fine up to ${formatUsdc(limit)} USDC (approved ${formatUsdc(d.usdcMicro)}).`
        : `Ask before auto-paying more than ${formatUsdc(limit)} USDC (objected to ${formatUsdc(d.usdcMicro)}).`;
    const [u] = await ctx.db.select({ acc: users.memwalAccountId }).from(users).where(eq(users.id, userId)).limit(1);
    await enqueueMemory(ctx, {
      ns: nsMember(userId),
      accountId: u?.acc ?? null,
      kind: 'limit',
      text: encodeMemory(sentence, { kind: 'limit', member: userId, usdcMicro: limit.toString() }),
    });
  }
  return { limit };
}
