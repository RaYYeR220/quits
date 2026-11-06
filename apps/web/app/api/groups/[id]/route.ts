import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { debts as debtsTable } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { handle, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

/** Everything the group screen needs: members, balances, open debts, recent expenses. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const q = await getQuits();
  await q.assertMember(id, s.uid);
  const [group, members, balances, debts, expenses] = await Promise.all([
    q.group(id),
    q.members(id),
    q.balances(id),
    q.refreshDebts(id),
    q.expenses(id, { includeDrafts: false }),
  ]);
  const mandates = await Promise.all(members.map(async (m) => [m.id, Boolean(await q.activeMandate(m.id, id))] as const));
  const settled = await q.ctx.db
    .select()
    .from(debtsTable)
    .where(and(eq(debtsTable.groupId, id), isNotNull(debtsTable.txDigest)))
    .orderBy(desc(debtsTable.settledAt))
    .limit(30);
  const mine = await q.activeMandate(s.uid, id);
  return {
    group,
    me: s.uid,
    members: members.map((m) => ({ id: m.id, name: m.name, suiAddress: m.suiAddress, ownMemory: Boolean(m.memwalAccountId), autoSettle: Object.fromEntries(mandates)[m.id] ?? false })),
    balances,
    debts,
    settled,
    myMandate: mine
      ? { mandateObjectId: mine.mandateObjectId, allowanceId: mine.allowanceId, maxPerDebt: mine.maxPerDebt, weeklyLimit: mine.weeklyLimit, lifetimeCap: mine.lifetimeCap, objectionWindowMs: mine.objectionWindowMs, openTx: mine.openTx }
      : null,
    tab: s.tab ?? null,
    expenses: expenses.slice(-50).reverse(),
  };
});
