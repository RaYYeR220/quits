import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import { debts, memories, tatumCalls } from '@quits/db';
import { blobUrl } from '@quits/memory';
import { listMemoryReceipts, type MemoryReceipt } from '@quits/chain';
import { chainConfig, getQuits, getSuiGraphql, memoryStore, network } from '@/lib/deps.ts';
import { explorerTx } from '@/lib/paydebt.ts';
import { handle } from '@/lib/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let receiptsCache: { at: number; value: { owner: string; agentId: string; count: number; latest: (MemoryReceipt & { suiscan: string })[] } | { error: string } | null } | null = null;

/** The Walrus Blob objects our delegate key wrote, read from chain through Tatum (cached for a minute). */
async function onchainReceipts() {
  const owner = process.env.MEMWAL_OWNER_ADDRESS?.trim();
  const agentId = process.env.MEMWAL_AGENT_ID?.trim();
  if (!owner || !agentId || network === 'localnet') return null;
  if (receiptsCache && Date.now() - receiptsCache.at < 60_000) return receiptsCache.value;
  let value: NonNullable<typeof receiptsCache>['value'];
  try {
    const list = await listMemoryReceipts(getSuiGraphql(), owner, { agentId, namespacePrefix: 'quits:' });
    value = { owner, agentId, count: list.length, latest: list.slice(0, 20).map((r) => ({ ...r, suiscan: `https://suiscan.xyz/mainnet/object/${r.objectId}` })) };
  } catch (e) {
    value = { error: e instanceof Error ? e.message : String(e) };
  }
  receiptsCache = { at: Date.now(), value };
  return value;
}

/** Public receipts: live Tatum traffic, memories stored on Walrus, settlements on Sui. */
export const GET = handle(async () => {
  const q = await getQuits();
  const db = q.ctx.db;
  const [calls, byMethod, stored, storedCount, settled] = await Promise.all([
    db.select().from(tatumCalls).orderBy(desc(tatumCalls.at)).limit(40),
    db
      .select({ surface: tatumCalls.surface, method: tatumCalls.method, n: sql<number>`count(*)::int`, okN: sql<number>`sum(case when ${tatumCalls.ok} then 1 else 0 end)::int`, avgMs: sql<number>`avg(${tatumCalls.ms})::int` })
      .from(tatumCalls)
      .groupBy(tatumCalls.surface, tatumCalls.method)
      .orderBy(desc(sql`count(*)`)),
    db.select({ ns: memories.ns, kind: memories.kind, blobId: memories.blobId, storedAt: memories.storedAt, text: memories.text }).from(memories).where(eq(memories.state, 'done')).orderBy(desc(memories.storedAt)).limit(30),
    db.select({ n: sql<number>`count(*)::int` }).from(memories).where(eq(memories.state, 'done')),
    db.select().from(debts).where(isNotNull(debts.txDigest)).orderBy(desc(debts.settledAt)).limit(30),
  ]);
  let pkg: string | null = null;
  try {
    pkg = chainConfig().pkg;
  } catch {
    pkg = null;
  }
  return {
    network,
    memoryBackend: memoryStore().kind,
    package: pkg,
    tatum: { recent: calls, byMethod },
    onchainMemory: await onchainReceipts(),
    memories: {
      stored: storedCount[0]?.n ?? 0,
      latest: stored.map((m) => ({ ...m, text: m.text.replace(/\s*⟦quits:v1 .*⟧\s*$/su, ''), walruscan: m.blobId ? blobUrl(m.blobId) : null })),
    },
    settlements: settled.map((d) => ({ id: d.id, usdcMicro: d.usdcMicro, status: d.status, digest: d.txDigest, at: d.settledAt, explorer: explorerTx(d.txDigest!) })),
  };
});
