import { getQuits } from '@/lib/deps.ts';
import { handle, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

/** Forget the local rule index and rebuild it from Walrus Memory alone. */
export const POST = handle(async (_req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const q = await getQuits();
  await q.assertMember(id, s.uid);
  const started = Date.now();
  const r = await q.rebuildFromWalrus(id);
  return { rebuilt: r.rules, ms: Date.now() - started, rules: await q.rules(id) };
});
