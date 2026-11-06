import { asc, eq, inArray } from 'drizzle-orm';
import { memories } from '@quits/db';
import { COST, type Bucket } from '@quits/memory';
import type { Ctx } from './context.ts';

/** Queues a memory for Walrus. The worker (or `drain`) writes it; the row tracks job → blob. */
export async function enqueueMemory(
  ctx: Ctx,
  m: { ns: string; kind: 'rule' | 'event' | 'limit'; text: string; accountId?: string | null },
): Promise<string> {
  const id = ctx.id();
  await ctx.db.insert(memories).values({ id, ns: m.ns, kind: m.kind, text: m.text, accountId: m.accountId ?? null, state: 'queued' });
  return id;
}

export interface DrainResult {
  submitted: number;
  stored: number;
  failed: number;
}

/**
 * Submits queued memories (bulk, ≤20 per call, per account) and polls submitted
 * ones. Safe to call repeatedly; a rate-limit error leaves rows queued for later.
 */
export async function drainMemoryQueue(ctx: Ctx, opts: { bucket?: Bucket; maxBatches?: number } = {}): Promise<DrainResult> {
  const out: DrainResult = { submitted: 0, stored: 0, failed: 0 };
  const maxBatches = opts.maxBatches ?? 5;

  for (let b = 0; b < maxBatches; b++) {
    const queued = await ctx.db.select().from(memories).where(eq(memories.state, 'queued')).orderBy(asc(memories.createdAt)).limit(20);
    if (queued.length === 0) break;
    const account = queued[0]?.accountId ?? null;
    const batch = queued.filter((q) => (q.accountId ?? null) === account);
    const target = account ? { accountId: account } : {};
    try {
      await opts.bucket?.take(batch.length === 1 ? COST.remember : COST.bulk);
      const jobIds =
        batch.length === 1
          ? [(await ctx.memory.remember(batch[0]!.ns, batch[0]!.text, target)).jobId]
          : (await ctx.memory.rememberBulk(batch.map((m) => ({ ns: m.ns, text: m.text })), target)).jobIds;
      for (const [i, m] of batch.entries()) {
        await ctx.db
          .update(memories)
          .set({ state: 'submitted', jobId: jobIds[i] ?? null, attempts: m.attempts + 1 })
          .where(eq(memories.id, m.id));
      }
      out.submitted += batch.length;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const m of batch) {
        const failed = m.attempts + 1 >= 5;
        await ctx.db
          .update(memories)
          .set({ attempts: m.attempts + 1, error: msg.slice(0, 300), state: failed ? 'failed' : 'queued' })
          .where(eq(memories.id, m.id));
        if (failed) out.failed += 1;
      }
      break;
    }
  }

  const pending = await ctx.db.select().from(memories).where(eq(memories.state, 'submitted')).limit(100);
  for (const m of pending) {
    if (!m.jobId) continue;
    try {
      const s = await ctx.memory.status(m.jobId, m.accountId ? { accountId: m.accountId } : {});
      if (s.state === 'done' && s.blobId) {
        await ctx.db.update(memories).set({ state: 'done', blobId: s.blobId, storedAt: ctx.now(), error: null }).where(eq(memories.id, m.id));
        out.stored += 1;
      } else if (s.state === 'failed' || s.state === 'not_found') {
        await ctx.db.update(memories).set({ state: 'queued', jobId: null, error: s.error ?? s.state }).where(eq(memories.id, m.id));
      }
    } catch {
      // status checks are retried on the next pass
    }
  }
  return out;
}

/** Test/bench helper: drain until nothing is queued or submitted. */
export async function flushMemory(ctx: Ctx): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await drainMemoryQueue(ctx);
    const left = await ctx.db
      .select({ id: memories.id })
      .from(memories)
      .where(inArray(memories.state, ['queued', 'submitted']))
      .limit(1);
    if (left.length === 0) return;
  }
  throw new Error('flushMemory: memories still pending');
}
