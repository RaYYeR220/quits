import { getQuits } from '@/lib/deps.ts';
import { handle, HttpError, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

/** The same expense split with only what Quits knew at `asOf` (day one vs today). */
export const GET = handle(async (req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const asOf = new URL(req.url).searchParams.get('asOf');
  if (!asOf || Number.isNaN(Date.parse(asOf))) throw new HttpError(400, 'asOf must be a date.');
  const q = await getQuits();
  const r = await q.replay(id, new Date(asOf).toISOString());
  await q.assertMember(r.expense.groupId, s.uid);
  return r;
});
