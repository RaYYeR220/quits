import { getQuits } from '@/lib/deps.ts';
import { body, handle, HttpError, requireSession, text } from '@/lib/route.ts';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  if (s.demo) throw new HttpError(403, 'Sign in to join a group.');
  const code = text((await body<{ code?: string }>(req)).code, 'code', 16);
  return { id: await (await getQuits()).joinByCode(code, s.uid) };
});
