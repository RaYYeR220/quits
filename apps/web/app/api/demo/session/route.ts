import { randomBytes } from 'node:crypto';
import { DEMO_MEMBERS } from '@quits/service';
import { ensureDemo, getQuits } from '@/lib/deps.ts';
import { body, handle, HttpError } from '@/lib/route.ts';
import { createSession } from '@/lib/session.ts';

export const runtime = 'nodejs';

/** Try Quits as one of the demo flatmates. No sign-in, no wallet, no funds needed. */
export const POST = handle(async (req: Request) => {
  const b = await body<{ as?: string; tab?: string }>(req);
  const m = DEMO_MEMBERS.find((x) => x.name.toLowerCase() === String(b.as ?? 'ana').toLowerCase());
  if (!m) throw new HttpError(400, 'Pick Ana, Ben, Clara or Dan.');
  await ensureDemo();
  const q = await getQuits();
  // switching member keeps the visitor's tab; a new visitor gets a fresh one
  const prev = typeof b.tab === 'string' && /^[a-z0-9]{8}$/.test(b.tab) ? b.tab : null;
  const key = prev ?? randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 8);
  const tab = await q.createSandbox(key);
  await createSession({ uid: m.id, demo: true, tab });
  return { uid: m.id, name: m.name, tab, tabKey: key };
});
