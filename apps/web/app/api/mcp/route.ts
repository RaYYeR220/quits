import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getQuits } from '@/lib/deps.ts';
import { json } from '@/lib/json.ts';
import { buildMcp, userForToken } from '@/lib/mcp.ts';

export const runtime = 'nodejs';

async function serve(req: Request): Promise<Response> {
  const q = await getQuits();
  const userId = await userForToken(q, req.headers.get('authorization'));
  if (!userId) {
    return json({ error: 'Create a token on your Quits profile and send it as a Bearer token.' }, { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildMcp(q, userId, new URL(req.url).origin);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
