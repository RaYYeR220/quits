import { randomBytes } from 'node:crypto';
import { authNonces } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { handle } from '@/lib/route.ts';

export const runtime = 'nodejs';

/** A one-time message for the wallet (or zkLogin account) to sign. */
export const POST = handle(async (req: Request) => {
  const nonce = randomBytes(16).toString('hex');
  const q = await getQuits();
  await q.ctx.db.insert(authNonces).values({ nonce, expiresAt: new Date(Date.now() + 5 * 60_000) });
  // the site is part of what the wallet signs, so a signature collected elsewhere can't sign in here
  const site = new URL(req.url).host;
  return { nonce, message: `Sign in to Quits\nSite: ${site}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}` };
});
