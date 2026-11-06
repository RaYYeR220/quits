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

/**
 * Follows Sui checkpoints through Tatum's gRPC `SubscribeCheckpoints`, filtered
 * to transactions that touch a member's address, and hands every USDC movement
 * to `onTx`. Reconnects on errors and every `refreshMs`.
 */
export async function followCheckpoints(d: StreamDeps): Promise<void> {
  const log = d.log ?? (() => {});
  while (!d.signal?.aborted) {
    const addresses = await d.addresses();
    if (addresses.length === 0) {
      await sleep(30_000, d.signal);
      continue;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), d.refreshMs ?? 10 * 60_000);
    d.signal?.addEventListener('abort', () => abort.abort(), { once: true });
    try {
      const call = d.client.subscriptionService.subscribeCheckpoints(
        {
          readMask: { paths: ['sequence_number', 'transactions.digest', 'transactions.balance_changes'] },
          filter: { terms: addresses.map((a) => ({ literals: [{ negated: false, predicate: { oneofKind: 'affectedAddress', affectedAddress: { address: a } } }] })) },
        },
        { abort: abort.signal },
      );
      log('stream open', { watching: addresses.length });
      for await (const frame of call.responses) {
        const cp = frame.checkpoint;
        if (!cp) continue;
        for (const tx of cp.transactions) {
          const changes = usdcChanges(tx.balanceChanges, d.usdcType);
          if (tx.digest && changes.length) await d.onTx({ digest: tx.digest, changes });
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        log('stream error', { error: e instanceof Error ? e.message : String(e) });
        await sleep(5_000, d.signal);
      }
    } finally {
      clearTimeout(timer);
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
