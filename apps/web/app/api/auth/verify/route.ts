import { and, eq, gt } from 'drizzle-orm';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { authNonces } from '@quits/db';
import { getQuits, getSuiGraphql } from '@/lib/deps.ts';
import { body, handle, HttpError, text } from '@/lib/route.ts';
import { createSession } from '@/lib/session.ts';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const b = await body<{ address?: string; signature?: string; message?: string; name?: string; provider?: string }>(req);
  const raw = text(b.address, 'address', 80);
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(raw)) throw new HttpError(400, 'That is not a Sui address.');
  const address = normalizeSuiAddress(raw);
  const message = text(b.message, 'message', 400);
  const signature = text(b.signature, 'signature', 20_000);
  const nonce = /Nonce: ([0-9a-f]{32})/.exec(message)?.[1];
  if (!nonce) throw new HttpError(400, 'Unknown sign-in message.');
  // the message names the site it was issued for; one signed for another site doesn't sign in here
  const site = /Site: (\S+)/.exec(message)?.[1];
  if (site !== new URL(req.url).host) throw new HttpError(401, 'This sign-in message was issued for another site.');

  const q = await getQuits();
  // consume the nonce in one statement, so two parallel requests can't both use it
  const used = await q.ctx.db
    .delete(authNonces)
    .where(and(eq(authNonces.nonce, nonce), gt(authNonces.expiresAt, new Date())))
    .returning({ nonce: authNonces.nonce });
  if (used.length === 0) throw new HttpError(401, 'Sign-in message expired. Try again.');

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
