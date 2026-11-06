import { randomBytes } from 'node:crypto';
import { apiTokens } from '@quits/db';
import { getQuits } from '@/lib/deps.ts';
import { hashToken } from '@/lib/mcp.ts';
import { body, handle, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';

/** A token for connecting an agent (MCP) to my Quits account. Shown once. */
export const POST = handle(async (req: Request) => {
  const s = await requireSession();
  const b = await body<{ label?: string }>(req).catch(() => ({ label: undefined }));
  const token = `qt_${randomBytes(24).toString('base64url')}`;
  const q = await getQuits();
  await q.ctx.db.insert(apiTokens).values({ tokenHash: hashToken(token), userId: s.uid, label: (b.label ?? (s.demo ? 'demo' : 'agent')).slice(0, 40) });
  return { token, mcpUrl: `${new URL(req.url).origin}/api/mcp` };
});
