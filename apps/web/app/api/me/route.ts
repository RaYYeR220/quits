import { eq } from 'drizzle-orm';
import { users } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { handle, requireSession } from '@/lib/route.ts';

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
