import { getQuits } from '@/lib/deps.ts';
import { body, handle, HttpError, requireSession, text } from '@/lib/route.ts';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const s = await requireSession();
  return { groups: await (await getQuits()).groupsOf(s.uid) };
});

export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  if (s.demo) throw new HttpError(403, 'Sign in to create your own group.');
  const b = await body<{ name?: string; currency?: string }>(req);
  const currency = typeof b.currency === 'string' && /^[A-Za-z]{3}$/.test(b.currency) ? b.currency : 'USD';
  const id = await (await getQuits()).createGroup({ name: text(b.name, 'name', 60), defaultCurrency: currency, ownerId: s.uid });
  return { id };
});
