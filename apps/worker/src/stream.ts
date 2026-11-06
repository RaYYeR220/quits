import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { usdcChanges, type ObservedTx } from './watcher.ts';

export interface StreamDeps {
  client: SuiGrpcClient;
  usdcType: string;
  /** Addresses worth watching (all members with a Sui address). Re-read on every reconnect. */
  addresses: () => Promise<string[]>;
  onTx: (tx: ObservedTx) => Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** Reconnect this often so newly joined members are picked up. */
  refreshMs?: number;
}

/** A checkpoint filter takes at most this many literals, so larger watch lists need several streams. */
export const MAX_LITERALS = 10;

/** Distinct addresses split into groups that each fit one filter. */
export function watchGroups(addresses: string[], size = MAX_LITERALS): string[][] {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) out.push(unique.slice(i, i + size));
  return out;
}

/**
 * Follows Sui checkpoints through Tatum's gRPC `SubscribeCheckpoints`, filtered
 * to transactions that touch a member's address, and hands every USDC movement
 * to `onTx`. One stream per group of ten addresses. Reconnects on errors (with
 * backoff, so a rate limit is not hammered) and every `refreshMs`.
 */
export async function followCheckpoints(d: StreamDeps): Promise<void> {
  const log = d.log ?? (() => {});
  let backoff = 5_000;
  while (!d.signal?.aborted) {
    const groups = watchGroups(await d.addresses());
    if (groups.length === 0) {
      await sleep(30_000, d.signal);
      continue;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), d.refreshMs ?? 10 * 60_000);
    const onStop = () => abort.abort();
    d.signal?.addEventListener('abort', onStop, { once: true });
    log('stream open', { watching: groups.reduce((n, g) => n + g.length, 0), streams: groups.length });
    try {
      await Promise.all(
        groups.map(async (group, i) => {
          // the free plan allows a few requests a second: open streams one by one, after the startup burst
          await sleep(1_500 * (i + 1), abort.signal);
          if (abort.signal.aborted) return;
          const call = d.client.subscriptionService.subscribeCheckpoints(
            {
              readMask: { paths: ['sequence_number', 'transactions.digest', 'transactions.balance_changes'] },
              filter: { terms: group.map((a) => ({ literals: [{ negated: false, predicate: { oneofKind: 'affectedAddress', affectedAddress: { address: a } } }] })) },
            },
            { abort: abort.signal },
          );
          for await (const frame of call.responses) {
            backoff = 5_000;
            const cp = frame.checkpoint;
            if (!cp) continue;
            for (const tx of cp.transactions) {
              const changes = usdcChanges(tx.balanceChanges, d.usdcType);
              if (tx.digest && changes.length) await d.onTx({ digest: tx.digest, changes });
            }
          }
        }),
      );
    } catch (e) {
      if (!abort.signal.aborted) {
        abort.abort();
        log('stream error', { error: e instanceof Error ? e.message : String(e), retryInMs: backoff });
        await sleep(backoff, d.signal);
        backoff = Math.min(backoff * 2, 120_000);
      }
    } finally {
      clearTimeout(timer);
      d.signal?.removeEventListener('abort', onStop);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      r();
    }, { once: true });
  });
}
