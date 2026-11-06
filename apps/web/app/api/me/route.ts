import { eq } from 'drizzle-orm';
import { users } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { body, handle, HttpError, requireSession, text } from '@/lib/route.ts';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const s = await requireSession();
  const q = await getQuits();
  const [u] = await q.ctx.db.select().from(users).where(eq(users.id, s.uid)).limit(1);
  return {
    user: u ? { id: u.id, name: u.name, suiAddress: u.suiAddress, ownMemory: Boolean(u.memwalAccountId), memwalAccountId: u.memwalAccountId } : null,
    demo: Boolean(s.demo),
    groups: await q.groupsOf(s.uid),
    autoPayLimit: await q.learnedLimit(s.uid),
  };
});

/** Set the name your groups see. Split notes and corrections refer to people by it. */
export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  if (s.demo) throw new HttpError(403, 'Demo flatmates keep their names.');
  const name = text((await body<{ name?: string }>(req)).name, 'name', 40).replace(/\s+/g, ' ');
  if (/^0x[0-9a-f]{4}/i.test(name)) throw new HttpError(400, 'Pick a name people would say out loud.');
  const q = await getQuits();
  await q.ctx.db.update(users).set({ name }).where(eq(users.id, s.uid));
  return { name };
});
