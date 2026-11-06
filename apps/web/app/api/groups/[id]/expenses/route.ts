import { getQuits } from '@/lib/deps.ts';
import { body, handle, requireSession, text } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

/** "84 € dinner, I paid, 24 of it was wine" → a proposed split with the memories behind it. */
export const POST = handle(async (req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const note = text((await body<{ text?: string }>(req)).text, 'text', 400);
  return (await getQuits()).addExpenseFromText(id, s.uid, note, { source: 'web' });
});

export const GET = handle(async (_req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const q = await getQuits();
  await q.assertMember(id, s.uid);
  return { expenses: (await q.expenses(id)).reverse() };
});
