/**
 * Which digest settled which debt. In production this sits on the debts table:
 * `claim` is an atomic `open → settling` update, `confirm` is `settling → settled`.
 */
export interface SettlementStore {
  /** Digest that settled this debt, once confirmed. */
  settledDigest(debtId: string): Promise<string | null>;
  /** Debt a confirmed digest settled. */
  settledDebt(digest: string): Promise<string | null>;
  /** Reserves the pair before executing; `false` if either side is reserved or settled already. */
  claim(digest: string, debtId: string): Promise<boolean>;
  /** Marks a reserved pair as settled. */
  confirm(digest: string, debtId: string): Promise<void>;
  /** Drops a reservation whose execution did not settle the debt. Settled pairs stay. */
  release(digest: string, debtId: string): Promise<void>;
}

export function createMemorySettlementStore(): SettlementStore {
  type Entry = { digest: string; debtId: string; settled: boolean };
  const byDebt = new Map<string, Entry>();
  const byDigest = new Map<string, Entry>();

  return {
    async settledDigest(debtId) {
      const entry = byDebt.get(debtId);
      return entry?.settled ? entry.digest : null;
    },
    async settledDebt(digest) {
      const entry = byDigest.get(digest);
      return entry?.settled ? entry.debtId : null;
    },
    async claim(digest, debtId) {
      if (byDebt.has(debtId) || byDigest.has(digest)) return false;
      const entry = { digest, debtId, settled: false };
      byDebt.set(debtId, entry);
      byDigest.set(digest, entry);
      return true;
    },
    async confirm(digest, debtId) {
      const entry = byDebt.get(debtId);
      if (entry?.digest !== digest) throw new Error(`No reservation of ${digest} for debt ${debtId}`);
      entry.settled = true;
    },
    async release(digest, debtId) {
      const entry = byDebt.get(debtId);
      if (entry?.digest !== digest || entry.settled) return;
      byDebt.delete(debtId);
      byDigest.delete(digest);
    },
  };
}
