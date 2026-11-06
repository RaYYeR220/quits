import { eq } from 'drizzle-orm';
import { users } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { confirmMandate, DEMO_TERMS, openDemoMandate, prepareMandate, type Terms } from '@/lib/mandates.ts';
import { body, handle, HttpError, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

function terms(b: Record<string, unknown>): Terms {
  const usdc = (v: unknown, fallback: bigint) => (typeof v === 'string' && /^\d{1,12}$/.test(v) ? BigInt(v) : fallback);
  const t: Terms = {
    lifetimeCap: usdc(b.lifetimeCap, 50_000_000n),
    weeklyLimit: usdc(b.weeklyLimit, 20_000_000n),
    maxPerDebt: usdc(b.maxPerDebt, 20_000_000n),
    objectionWindowMs: typeof b.objectionWindowMs === 'number' && Number.isFinite(b.objectionWindowMs) ? Math.floor(Math.max(60_000, Math.min(b.objectionWindowMs, 7 * 86_400_000))) : 12 * 3_600_000,
    days: typeof b.days === 'number' && Number.isFinite(b.days) ? Math.floor(Math.max(1, Math.min(b.days, 90))) : 30,
  };
  if (t.maxPerDebt > t.weeklyLimit || t.weeklyLimit > t.lifetimeCap) throw new HttpError(400, 'Limits must satisfy per-debt ≤ weekly ≤ lifetime.');
  return t;
}

/**
 * Turn on auto-settle in a group. Demo members: one call, signed by their demo
 * wallet. Real members: `{step: "prepare"}` returns the transaction to sign,
 * `{step: "confirm", txBytes, signature}` executes it through Tatum and records it.
 */
export const POST = handle(async (req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const q = await getQuits();
  await q.assertMember(id, s.uid);
  const b = await body<Record<string, unknown>>(req);
  if (s.demo) return { ...(await openDemoMandate(q, s.uid, id)), terms: DEMO_TERMS };

  const [u] = await q.ctx.db.select().from(users).where(eq(users.id, s.uid)).limit(1);
  if (!u?.suiAddress) throw new HttpError(409, 'Connect a wallet first.');
  const t = terms(b);
  if (b.step === 'confirm') {
    if (typeof b.txBytes !== 'string' || typeof b.signature !== 'string') throw new HttpError(400, 'txBytes and signature are required.');
    return { ...(await confirmMandate(q, s.uid, u.suiAddress, id, { txBytes: b.txBytes, signature: b.signature }, t)), terms: t };
  }
  return prepareMandate(q, s.uid, u.suiAddress, id, t);
});
