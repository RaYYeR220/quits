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
  return {
    group,
    me: s.uid,
    members: members.map((m) => ({ id: m.id, name: m.name, suiAddress: m.suiAddress, ownMemory: Boolean(m.memwalAccountId), autoSettle: Object.fromEntries(mandates)[m.id] ?? false })),
    balances,
    debts,
    expenses: expenses.slice(-50).reverse(),
  };
});
