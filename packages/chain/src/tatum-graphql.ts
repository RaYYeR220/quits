import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { elapsedSince, noopCallLog, recordCall, type CallLog } from './calllog.ts';
import { LOCALNET_GRAPHQL_URL, PUBLIC_GRAPHQL_URL, TATUM_GRAPHQL_URL, type SuiNetwork } from './config.ts';
import { sharedLimiter, type Limiter } from './limiter.ts';

export interface TatumGraphQLOptions {
  apiKey?: string;
  network: SuiNetwork;
  log?: CallLog;
  limiter?: Limiter | null;
  url?: string;
  fetch?: typeof fetch;
}

/** GraphQL client for Tatum's Sui gateway (fallback reads, event history). */
export function createTatumGraphQL({ apiKey, network, log = noopCallLog, limiter, url, fetch: base = fetch }: TatumGraphQLOptions): SuiGraphQLClient {
  const throttle = limiter !== undefined ? limiter : network === 'localnet' ? null : sharedLimiter(apiKey ?? '');
  return new SuiGraphQLClient({
    url: url ?? (network === 'localnet' ? LOCALNET_GRAPHQL_URL : TATUM_GRAPHQL_URL[network]),
    network,
    headers: apiKey ? { 'x-api-key': apiKey } : {},
    fetch: meteredFetch(base, { log, limiter: throttle, ...(network === 'localnet' || url ? {} : { fallbackUrl: PUBLIC_GRAPHQL_URL[network] }) }),
  });
}

const FALLBACK_MS = 10 * 60_000;

/** `fetch` that waits for the limiter and records each GraphQL operation. */
export function meteredFetch(base: typeof fetch, { log, limiter, fallbackUrl }: { log: CallLog; limiter: Limiter | null; fallbackUrl?: string }): typeof fetch {
  let fallbackUntil = 0;
  const viaFallback = async (method: string, init: RequestInit | undefined) => {
    const t0 = performance.now();
    const headers = new Headers(init?.headers);
    headers.delete('x-api-key');
    const res = await base(fallbackUrl!, { ...init, headers });
    recordCall(log, { surface: 'fallback', method, ms: elapsedSince(t0), ok: res.ok, ...(res.ok ? {} : { code: String(res.status) }) });
    return res;
  };
  return async (input, init) => {
    const method = operationName(init?.body);
    // out of credits: the public GraphQL endpoint answers for a while, and the call log says so
    if (fallbackUrl && Date.now() < fallbackUntil) return viaFallback(method, init);
    if (limiter) await limiter.take();
    const t0 = performance.now();
    try {
      const res = await base(input, init);
      if (fallbackUrl && (res.status === 402 || res.status === 403)) {
        recordCall(log, { surface: 'graphql', method, ms: elapsedSince(t0), ok: false, code: 'OUT_OF_CREDITS' });
        fallbackUntil = Date.now() + FALLBACK_MS;
        return viaFallback(method, init);
      }
      recordCall(log, { surface: 'graphql', method, ms: elapsedSince(t0), ok: res.ok, ...(res.ok ? {} : { code: String(res.status) }) });
      return res;
    } catch (err) {
      recordCall(log, { surface: 'graphql', method, ms: elapsedSince(t0), ok: false });
      throw err;
    }
  };
}

function operationName(body: unknown): string {
  if (typeof body !== 'string') return 'graphql';
  try {
    const { query, operationName: named } = JSON.parse(body) as { query?: string; operationName?: string };
    if (named) return named;
    return /\b(?:query|mutation)\s+(\w+)/.exec(query ?? '')?.[1] ?? 'graphql';
  } catch {
    return 'graphql';
  }
}
