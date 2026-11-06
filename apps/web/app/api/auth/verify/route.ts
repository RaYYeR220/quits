import { eq } from 'drizzle-orm';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { authNonces } from '@quits/db';
import { getQuits, getSuiGraphql } from '@/lib/deps.ts';
import { body, handle, HttpError, text } from '@/lib/route.ts';
import { createSession } from '@/lib/session.ts';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const b = await body<{ address?: string; signature?: string; message?: string; name?: string; provider?: string }>(req);
  const address = text(b.address, 'address', 80);
  const message = text(b.message, 'message', 400);
  const signature = text(b.signature, 'signature', 20_000);
  const nonce = /Nonce: ([0-9a-f]{32})/.exec(message)?.[1];
  if (!nonce) throw new HttpError(400, 'Unknown sign-in message.');

  const q = await getQuits();
  const [row] = await q.ctx.db.select().from(authNonces).where(eq(authNonces.nonce, nonce)).limit(1);
  if (!row || row.expiresAt < new Date()) throw new HttpError(401, 'Sign-in message expired. Try again.');
  await q.ctx.db.delete(authNonces).where(eq(authNonces.nonce, nonce));

  try {
    // zkLogin signatures are checked against the chain, so the verifier needs a client
    await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature, { address, client: getSuiGraphql() });
  } catch {
    throw new HttpError(401, 'Signature did not verify.');
  }
  const provider = b.provider === 'zklogin' ? 'zklogin' : 'wallet';
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : `${address.slice(0, 6)}…${address.slice(-4)}`;
  const uid = await q.ensureUser({ name, suiAddress: address, authProvider: provider });
  await createSession({ uid });
  return { uid };
});
