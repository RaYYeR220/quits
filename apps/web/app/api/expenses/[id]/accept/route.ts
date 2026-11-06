import { getQuits } from '@/lib/deps.ts';
import { handle, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const q = await getQuits();
  const r = await q.accept(id, s.uid);
  return { ...r, debts: await q.refreshDebts(r.expense.groupId) };
});
