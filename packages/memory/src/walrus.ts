import { MemWal, MemWalMock } from '@mysten-incubation/memwal';
import type { MemoryStore, Recalled, WriteTarget } from './store.ts';

interface Client {
  remember: MemWal['remember'];
  rememberBulk: MemWal['rememberBulk'];
  getRememberStatus: MemWal['getRememberStatus'];
  recall: (params: { query: string; namespace?: string; topK?: number; sort?: 'relevance' | 'recent' }) => ReturnType<MemWal['recall']>;
  health: () => Promise<unknown>;
}

function wrap(kind: 'walrus' | 'mock', clientFor: (accountId?: string) => Client): MemoryStore {
  return {
    kind,
    async remember(ns, text, o) {
      const r = await clientFor(o?.accountId).remember(text, ns);
      return { jobId: r.job_id };
    },
    async rememberBulk(items, o) {
      if (items.length === 0) return { jobIds: [] };
      if (items.length > 20) throw new Error('rememberBulk: at most 20 items per call');
      const r = await clientFor(o?.accountId).rememberBulk(items.map((i) => ({ text: i.text, namespace: i.ns })));
      return { jobIds: r.job_ids };
    },
    async status(jobId, o?: WriteTarget) {
      const s = await clientFor(o?.accountId).getRememberStatus(jobId);
      return { state: s.status, ...(s.blob_id ? { blobId: s.blob_id } : {}), ...(s.error ? { error: s.error } : {}) };
    },
    async recall(ns, query, o) {
      const r = await clientFor(o?.accountId).recall({ query, namespace: ns, topK: o?.topK ?? 20, sort: o?.sort ?? 'relevance' });
      return r.results.map(
        (m): Recalled => ({ text: m.text, blobId: m.blob_id, distance: m.distance, ...(m.created_at ? { createdAt: m.created_at } : {}) }),
      );
    },
    async health(o) {
      try {
        await clientFor(o?.accountId).health();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Walrus Memory on the hosted relayer. One SDK client per account (operator or member-owned). */
export function createWalrusStore(cfg: { key: string; accountId: string; serverUrl?: string }): MemoryStore {
  const clients = new Map<string, MemWal>();
  return wrap('walrus', (accountId) => {
    const id = accountId ?? cfg.accountId;
    let c = clients.get(id);
    if (!c) {
      c = MemWal.create({ key: cfg.key, accountId: id, ...(cfg.serverUrl ? { serverUrl: cfg.serverUrl } : {}) });
      clients.set(id, c);
    }
    return c as unknown as Client;
  });
}

/** In-memory stand-in with the same API (token-overlap recall, instant jobs). */
export function createMockStore(): MemoryStore {
  const clients = new Map<string, MemWalMock>();
  return wrap('mock', (accountId) => {
    const id = accountId ?? 'operator';
    let c = clients.get(id);
    if (!c) {
      c = MemWalMock.create({ owner: id });
      clients.set(id, c);
    }
    return c as unknown as Client;
  });
}
