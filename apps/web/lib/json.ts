/** JSON response that turns bigints into strings (money is bigint micro-USDC everywhere). */
export function json(data: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return new Response(body, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
}
