import { randomBytes } from 'node:crypto';
import { apiTokens } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { hashToken } from '@/lib/mcp.ts';
import { handle, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

/** A one-time link that ties my Telegram account to Quits (the bot reads it from /start). */
export const POST = handle(async () => {
  const s = await requireSession();
  const code = randomBytes(18).toString('base64url');
  const q = await getQuits();
  await q.ctx.db.insert(apiTokens).values({ tokenHash: hashToken(code), userId: s.uid, label: 'telegram' });
  const bot = process.env.TELEGRAM_BOT_USERNAME ?? 'quits_tab_bot';
  return { url: `https://t.me/${bot}?start=${code}`, bot };
});
