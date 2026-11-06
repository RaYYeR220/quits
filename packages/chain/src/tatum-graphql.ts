import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { elapsedSince, noopCallLog, recordCall, type CallLog } from './calllog.ts';
import { LOCALNET_GRAPHQL_URL, TATUM_GRAPHQL_URL, type SuiNetwork } from './config.ts';
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
    fetch: meteredFetch(base, { log, limiter: throttle }),
  });
}

/** `fetch` that waits for the limiter and records each GraphQL operation. */
export function meteredFetch(base: typeof fetch, { log, limiter }: { log: CallLog; limiter: Limiter | null }): typeof fetch {
  return async (input, init) => {
    if (limiter) await limiter.take();
    const method = operationName(init?.body);
    const t0 = performance.now();
    try {
      const res = await base(input, init);
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
