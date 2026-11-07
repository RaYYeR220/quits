import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { debts, memories, tatumCalls } from '@quits/db';
import { blobUrl } from '@quits/memory';
import { DEFINITE_CODES, listMemoryReceipts, type MemoryReceipt } from '@quits/chain';
import { chainConfig, getQuits, getSuiGraphql, memoryStore, network } from '@/lib/deps.ts';
import { explorerTx } from '@/lib/paydebt.ts';
import { handle } from '@/lib/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let receiptsCache: { at: number; value: { owner: string; agentId: string; count: number; latest: (MemoryReceipt & { suiscan: string })[] } | { error: string } | null } | null = null;

/** The Walrus Blob objects our delegate key wrote, read from chain through Tatum (cached for ten minutes). */
async function onchainReceipts() {
  const owner = process.env.MEMWAL_OWNER_ADDRESS?.trim();
  const agentId = process.env.MEMWAL_AGENT_ID?.trim();
  if (!owner || !agentId || network === 'localnet') return null;
  // on-chain receipts change only when a memory lands; ten minutes keeps a page left open from spending gateway credits
  if (receiptsCache && Date.now() - receiptsCache.at < 600_000) return receiptsCache.value;
  let value: NonNullable<typeof receiptsCache>['value'];
  try {
    const list = await listMemoryReceipts(getSuiGraphql(), owner, { agentId, namespacePrefix: 'quits:' });
    value = { owner, agentId, count: list.length, latest: list.slice(0, 20).map((r) => ({ ...r, suiscan: `https://suiscan.xyz/mainnet/object/${r.objectId}` })) };
  } catch (e) {
    // keep showing the last good read (it is at most a few minutes old) rather than an error box
    if (receiptsCache && !('error' in (receiptsCache.value ?? {}))) return receiptsCache.value;
    value = { error: e instanceof Error ? e.message : String(e) };
    receiptsCache = { at: Date.now() - 540_000, value }; // retry in a minute, not ten
    return value;
  }
  receiptsCache = { at: Date.now(), value };
  return value;
}

/** Public receipts: live Tatum traffic, memories stored on Walrus, settlements on Sui. */
export const GET = handle(async () => {
  const q = await getQuits();
  const db = q.ctx.db;
  // The panel covers the last day, so it shows how the integration behaves now.
  const recent = gt(tatumCalls.at, sql`now() - interval '24 hours'`);
  // "answered": a result, or a definite answer such as not found or a rejected transaction
  const answeredSql = sql`(${tatumCalls.ok} or coalesce(${tatumCalls.code}, '') in (${sql.join(DEFINITE_CODES.map((c) => sql`${c}`), sql`, `)}))`;
  const [calls, byMethod, failures, stored, storedCount, settled] = await Promise.all([
    db.select().from(tatumCalls).orderBy(desc(tatumCalls.at)).limit(40),
    db
      .select({ surface: tatumCalls.surface, method: tatumCalls.method, n: sql<number>`count(*)::int`, okN: sql<number>`sum(case when ${answeredSql} then 1 else 0 end)::int`, avgMs: sql<number>`avg(${tatumCalls.ms})::int` })
      .from(tatumCalls)
      .where(recent)
      .groupBy(tatumCalls.surface, tatumCalls.method)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ code: sql<string>`coalesce(${tatumCalls.code}, 'unknown')`, n: sql<number>`count(*)::int` })
      .from(tatumCalls)
      .where(and(recent, sql`not (${answeredSql})`))
      .groupBy(sql`1`)
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
    tatum: { recent: calls, byMethod, failures, windowHours: 24 },
    onchainMemory: await onchainReceipts(),
    memories: {
      stored: storedCount[0]?.n ?? 0,
      latest: stored.map((m) => ({ ...m, text: m.text.replace(/\s*⟦quits:v1 .*⟧\s*$/su, ''), walruscan: m.blobId ? blobUrl(m.blobId) : null })),
    },
    settlements: settled.map((d) => ({ id: d.id, usdcMicro: d.usdcMicro, status: d.status, digest: d.txDigest, at: d.settledAt, explorer: explorerTx(d.txDigest!) })),
  };
});
