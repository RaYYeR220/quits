import { getQuits } from '@/lib/deps.ts';
import { body, handle, HttpError, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

/** Approve or object to an auto-payment; Quits adjusts how much it pays without asking. */
export const POST = handle(async (req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const d = (await body<{ decision?: string }>(req)).decision;
  if (d !== 'approve' && d !== 'object') throw new HttpError(400, 'decision must be approve or object.');
  return (await getQuits()).decide(id, s.uid, d);
});
