import { getQuits } from '@/lib/deps.ts';
import { body, handle, requireSession, text } from '@/lib/route.ts';

export const runtime = 'nodejs';

type P = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: P) => {
  const s = await requireSession();
  const { id } = await params;
  const said = text((await body<{ text?: string }>(req)).text, 'text', 300);
  return (await getQuits()).correct(id, s.uid, said, { keepInGroup: Boolean(s.demo) });
});
