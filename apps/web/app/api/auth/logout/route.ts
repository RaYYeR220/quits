import { handle } from '@/lib/route.ts';
import { endSession } from '@/lib/session.ts';

export const POST = handle(async () => {
  await endSession();
  return { ok: true };
});
