import { and, eq, inArray, or } from 'drizzle-orm';
import { decodeMemory, encodeMemory, RuleSchema, supersede, type Rule } from '@quits/core';
import { memories, rules as rulesTable, users } from '@quits/db';
import { nsGroupRules, nsMember } from '@quits/memory';
import type { Ctx } from './context.ts';
import { enqueueMemory } from './memoryQueue.ts';

export type RuleState = 'stored' | 'saving' | 'cached';

export interface RuleInfo {
  rule: Rule;
  sentence: string;
  scope: 'group' | 'member';
  state: RuleState;
  blobId?: string;
  /** For member rules: whose portable memory it lives in. */
  ownerId?: string;
}

export interface LoadedRules {
  rules: Rule[];
  info: Map<string, RuleInfo>;
  /** Number of memories read back from Walrus for this decision. */
  memoriesRead: number;
  degraded?: 'cached';
}

async function accountsFor(ctx: Ctx, userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const rows = await ctx.db.select({ id: users.id, acc: users.memwalAccountId }).from(users).where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r.acc]));
}

/** Rules this group's decision may use, from the DB index (no Walrus read). */
async function indexedRules(ctx: Ctx, groupId: string, memberIds: string[]) {
  const where = memberIds.length
    ? or(eq(rulesTable.groupId, groupId), and(eq(rulesTable.scope, 'member'), inArray(rulesTable.userId, memberIds)))
    : eq(rulesTable.groupId, groupId);
  return ctx.db
    .select({ r: rulesTable, mState: memories.state, blobId: memories.blobId })
    .from(rulesTable)
    .leftJoin(memories, eq(memories.id, rulesTable.memoryId))
    .where(where);
}

function parseBody(body: unknown): Rule | null {
  const p = RuleSchema.safeParse(body);
  return p.success ? p.data : null;
}

/**
 * Loads the rules for a decision by reading them back from Walrus Memory:
 * the group's rules namespace plus each participant's portable namespace.
 * Rules learned moments ago (still being written) come from the local index,
 * marked `saving`. If Walrus can't be read, the local index is used and the
 * result is marked `degraded: 'cached'`.
 */
export async function loadRules(
  ctx: Ctx,
  groupId: string,
  participants: string[],
  opts: { asOf?: string; query?: string } = {},
): Promise<LoadedRules> {
  const info = new Map<string, RuleInfo>();
  if (!ctx.memoryEnabled) return { rules: [], info, memoriesRead: 0 };

  const indexed = await indexedRules(ctx, groupId, participants);
  const keep = (r: Rule) => !opts.asOf || r.learnedAt <= opts.asOf;
  let memoriesRead = 0;
  let degraded: 'cached' | undefined;

  try {
    const accounts = await accountsFor(ctx, participants);
    const query = opts.query?.trim() || 'how this group splits shared expenses';
    const reads: { ns: string; owner?: string; accountId?: string | null }[] = [
      { ns: nsGroupRules(groupId) },
      ...participants.map((p) => ({ ns: nsMember(p), owner: p, accountId: accounts.get(p) ?? null })),
    ];
    const results = await Promise.all(
      reads.map(async (r) => ({ r, hits: await ctx.memory.recall(r.ns, query, { topK: 100, ...(r.accountId ? { accountId: r.accountId } : {}) }) })),
    );
    for (const { r, hits } of results) {
      for (const h of hits) {
        memoriesRead += 1;
        const d = decodeMemory(h.text);
        if (d.payload?.kind !== 'rule') continue;
        const rule = d.payload.rule;
        // a member's namespace may only carry rules about that member
        if (r.owner && !(rule.kind === 'exclude' && rule.member === r.owner)) continue;
        if (!keep(rule)) continue;
        info.set(rule.id, { rule, sentence: d.sentence, scope: d.payload.scope, state: 'stored', blobId: h.blobId, ...(r.owner ? { ownerId: r.owner } : {}) });
      }
    }
    for (const row of indexed) {
      const rule = parseBody(row.r.body);
      if (!rule || info.has(rule.id) || !keep(rule)) continue;
      // Written but not read back this time (relayer index lag, expiry): apply from the
      // local index and say so on the rule, rather than dropping it silently.
      const state: RuleState = row.mState === 'done' ? 'cached' : 'saving';
      info.set(rule.id, {
        rule,
        sentence: row.r.sentence,
        scope: row.r.scope,
        state,
        ...(state === 'cached' && row.blobId ? { blobId: row.blobId } : {}),
        ...(row.r.userId ? { ownerId: row.r.userId } : {}),
      });
    }
  } catch {
    degraded = 'cached';
    info.clear();
    for (const row of indexed) {
      const rule = parseBody(row.r.body);
      if (!rule || !keep(rule)) continue;
      info.set(rule.id, {
        rule,
        sentence: row.r.sentence,
        scope: row.r.scope,
        state: 'cached',
        ...(row.blobId ? { blobId: row.blobId } : {}),
        ...(row.r.userId ? { ownerId: row.r.userId } : {}),
      });
    }
  }

  const rules = supersede([...info.values()].map((i) => i.rule));
  return { rules, info, memoriesRead, ...(degraded ? { degraded } : {}) };
}

/** Records a learned rule: local index row + a memory queued for Walrus. */
export async function learnRule(
  ctx: Ctx,
  r: { rule: Rule; scope: 'group' | 'member'; sentence: string; groupId: string; createdBy?: string; sourceExpenseId?: string },
): Promise<{ ruleId: string; memoryId: string }> {
  const subject = r.scope === 'member' && r.rule.kind === 'exclude' ? r.rule.member : null;
  const scope = subject ? 'member' : 'group';
  let accountId: string | null = null;
  if (subject) {
    const [u] = await ctx.db.select({ acc: users.memwalAccountId }).from(users).where(eq(users.id, subject)).limit(1);
    accountId = u?.acc ?? null;
  }
  const text = encodeMemory(r.sentence, { kind: 'rule', scope, rule: r.rule });
  const memoryId = await enqueueMemory(ctx, {
    ns: subject ? nsMember(subject) : nsGroupRules(r.groupId),
    kind: 'rule',
    text,
    accountId,
  });
  await ctx.db.insert(rulesTable).values({
    id: r.rule.id,
    scope,
    groupId: subject ? null : r.groupId,
    userId: subject,
    kind: r.rule.kind,
    body: r.rule as unknown as Record<string, unknown>,
    sentence: r.sentence,
    learnedAt: new Date(r.rule.learnedAt),
    memoryId,
    sourceExpenseId: r.sourceExpenseId ?? null,
    createdBy: r.createdBy ?? null,
  });
  return { ruleId: r.rule.id, memoryId };
}

export interface ListedRule {
  id: string;
  sentence: string;
  scope: 'group' | 'member';
  ownerId: string | null;
  kind: string;
  learnedAt: string;
  memoryState: 'queued' | 'submitted' | 'done' | 'failed' | null;
  blobId: string | null;
  status: 'active' | 'superseded' | 'revocation';
  rule: Rule;
}

/** Everything the group has learned, newest first, with its Walrus status. */
export async function listRules(ctx: Ctx, groupId: string, memberIds: string[]): Promise<ListedRule[]> {
  const rows = await indexedRules(ctx, groupId, memberIds);
  const parsed = rows.flatMap((row) => {
    const rule = parseBody(row.r.body);
    return rule ? [{ row, rule }] : [];
  });
  const active = new Set(supersede(parsed.map((p) => p.rule)).map((r) => r.id));
  return parsed
    .map(({ row, rule }) => ({
      id: rule.id,
      sentence: row.r.sentence,
      scope: row.r.scope,
      ownerId: row.r.userId,
      kind: rule.kind,
      learnedAt: rule.learnedAt,
      memoryState: row.mState ?? null,
      blobId: row.blobId ?? null,
      status: rule.revoked ? ('revocation' as const) : active.has(rule.id) ? ('active' as const) : ('superseded' as const),
      rule,
    }))
    .sort((a, b) => (a.learnedAt < b.learnedAt ? 1 : -1));
}

/**
 * Rebuilds the local rule index for a group from Walrus alone: wipe the rows,
 * read every rule memory back, re-index. Proves the product's knowledge lives
 * in the members' memory, not in our database.
 */
export async function rebuildFromWalrus(
  ctx: Ctx,
  groupId: string,
  memberIds: string[],
): Promise<{ rules: number; indexed: number; complete: boolean }> {
  const accounts = await accountsFor(ctx, memberIds);
  const reads = [
    { ns: nsGroupRules(groupId), owner: undefined as string | undefined, accountId: null as string | null },
    ...memberIds.map((m) => ({ ns: nsMember(m), owner: m, accountId: accounts.get(m) ?? null })),
  ];
  const found: { rule: Rule; sentence: string; scope: 'group' | 'member'; blobId: string; ns: string; owner?: string; accountId: string | null }[] = [];
  for (const r of reads) {
    const hits = await ctx.memory.recall(r.ns, 'how this group splits shared expenses', { topK: 100, ...(r.accountId ? { accountId: r.accountId } : {}) });
    for (const h of hits) {
      const d = decodeMemory(h.text);
      if (d.payload?.kind !== 'rule') continue;
      if (r.owner && !(d.payload.rule.kind === 'exclude' && d.payload.rule.member === r.owner)) continue;
      found.push({ rule: d.payload.rule, sentence: d.sentence, scope: d.payload.scope, blobId: h.blobId, ns: r.ns, ...(r.owner ? { owner: r.owner } : {}), accountId: r.accountId });
    }
  }

  const existing = await indexedRules(ctx, groupId, memberIds);
  const stored = existing.filter((e) => e.mState === 'done').map((e) => e.r.id);
  const foundIds = new Set(found.map((f) => f.rule.id));
  // Only replace the index when Walrus gave back everything it holds; otherwise keep it and say so.
  if (!stored.every((id) => foundIds.has(id))) return { rules: found.length, indexed: stored.length, complete: false };
  const ids = existing.map((e) => e.r.id);
  if (ids.length) await ctx.db.delete(rulesTable).where(inArray(rulesTable.id, ids));

  for (const f of found) {
    const memoryId = ctx.id();
    await ctx.db.insert(memories).values({
      id: memoryId,
      ns: f.ns,
      kind: 'rule',
      text: encodeMemory(f.sentence, { kind: 'rule', scope: f.scope, rule: f.rule }),
      accountId: f.accountId,
      blobId: f.blobId,
      state: 'done',
      storedAt: ctx.now(),
    });
    await ctx.db
      .insert(rulesTable)
      .values({
        id: f.rule.id,
        scope: f.owner ? 'member' : 'group',
        groupId: f.owner ? null : groupId,
        userId: f.owner ?? null,
        kind: f.rule.kind,
        body: f.rule as unknown as Record<string, unknown>,
        sentence: f.sentence,
        learnedAt: new Date(f.rule.learnedAt),
        memoryId,
      })
      .onConflictDoNothing();
  }
  return { rules: found.length, indexed: stored.length, complete: true };
}
