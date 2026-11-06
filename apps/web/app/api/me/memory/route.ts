import { getQuits } from '@/lib/deps.ts';
import { body, handle, HttpError, requireSession, text } from '@/lib/route.ts';

export const runtime = 'nodejs';

/** Keep my portable memory in my own Walrus Memory account (after adding the Quits delegate key there). */
export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  if (s.demo) throw new HttpError(403, 'Demo members use the shared demo account.');
  const accountId = text((await body<{ accountId?: string }>(req)).accountId, 'accountId', 80);
  if (!/^0x[0-9a-f]{64}$/i.test(accountId)) throw new HttpError(400, 'That doesn’t look like a Walrus Memory account id.');
  const q = await getQuits();
  const r = await q.setOwnMemoryAccount(s.uid, accountId);
  if (!r.ok) throw new HttpError(400, r.reason === 'delegate_not_added' ? 'Add the Quits delegate key to that account first.' : 'Could not reach that account.');
  return r;
});
