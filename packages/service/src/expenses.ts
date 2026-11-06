import { and, asc, eq } from 'drizzle-orm';
import { encodeMemory, formatUsdc, split, type Expense, type Item, type Micro, type Tag } from '@quits/core';
import { corrections, expenses, shares } from '@quits/db';
import { compileCorrection, parseExpense, type ExpenseDraft, type Missing } from '@quits/llm';
import { nsGroupLog } from '@quits/memory';
import { QuitsError, type Ctx } from './context.ts';
import { PEGGED, toUsdcMicro } from './fx.ts';
import { assertMember, getGroup, groupMembers } from './groups.ts';
import { learnRule, loadRules, type RuleState } from './learned.ts';
import { enqueueMemory } from './memoryQueue.ts';

export interface Why {
  ruleId: string;
  sentence: string;
  learnedAt: string;
  state: RuleState;
  scope: 'group' | 'member';
  blobId?: string;
  /** "whole expense" or the item label the rule touched. */
  appliesTo: string[];
}

export interface Proposal {
  draftId: string;
  expense: Expense;
  shares: Record<string, Micro>;
  why: Why[];
  conflict: boolean;
  applied: { ruleId: string; target: 'expense' | number }[];
  memoriesRead: number;
  degraded?: 'cached';
  fx: { rate: string; source: string } | null;
}

export type AddResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; missing: Missing[] }
  | { ok: false; fxUnavailable: string };

type Row = typeof expenses.$inferSelect;

function rowToExpense(r: Row): Expense {
  return {
    id: r.id,
    groupId: r.groupId,
    payerId: r.payerId,
    usdcMicro: r.usdcMicro,
    currency: r.currency,
    amountMinor: r.amountMinor,
    category: r.category as Expense['category'],
    items: r.items.map((i) => ({ label: i.label, usdcMicro: BigInt(i.usdcMicro), tags: i.tags as Tag[] })),
    participants: r.participants,
    description: r.description,
    occurredAt: r.occurredAt.toISOString(),
  };
}

function itemsJson(items: Item[]) {
  return items.map((i) => ({ label: i.label, usdcMicro: i.usdcMicro.toString(), tags: i.tags }));
}

async function price(ctx: Ctx, d: ExpenseDraft): Promise<{ usdcMicro: Micro; items: Item[]; fx: { rate: string; source: string; at: string } } | { fxUnavailable: string }> {
  let fx: { rate: string; source: string; at: string };
  if (PEGGED.has(d.currency)) fx = { rate: '1', source: 'peg', at: ctx.now().toISOString() };
  else {
    try {
      fx = await ctx.fx.usdcPerFiat(d.currency);
    } catch {
      return { fxUnavailable: d.currency };
    }
  }
  const usdcMicro = toUsdcMicro(d.amountMinor, d.currency, fx.rate);
  let left = usdcMicro;
  const items: Item[] = d.items.map((i) => {
    const v = toUsdcMicro(i.amountMinor, d.currency, fx.rate);
    const capped = v > left ? left : v;
    left -= capped;
    return { label: i.label, usdcMicro: capped, tags: i.tags };
  });
  return { usdcMicro, items, fx };
}

function querySeed(e: Expense): string {
  const tags = [...new Set(e.items.flatMap((i) => i.tags))];
  return `${e.description} ${e.category} ${tags.join(' ')}`.trim();
}

/** Splits an expense with the rules read back from memory and explains which ones applied. */
export async function propose(ctx: Ctx, e: Expense, opts: { asOf?: string } = {}): Promise<Omit<Proposal, 'draftId' | 'fx'>> {
  const loaded = await loadRules(ctx, e.groupId, e.participants, { ...opts, query: querySeed(e) });
  const r = split(e, loaded.rules);
  const why = new Map<string, Why>();
  for (const a of r.applied) {
    const info = loaded.info.get(a.ruleId);
    if (!info) continue;
    const label = a.target === 'expense' ? 'whole expense' : (e.items[a.target]?.label ?? 'item');
    const w = why.get(a.ruleId);
    if (w) {
      if (!w.appliesTo.includes(label)) w.appliesTo.push(label);
      continue;
    }
    why.set(a.ruleId, {
      ruleId: a.ruleId,
      sentence: info.sentence,
      learnedAt: info.rule.learnedAt,
      state: info.state,
      scope: info.scope,
      ...(info.blobId ? { blobId: info.blobId } : {}),
      appliesTo: [label],
    });
  }
  return {
    expense: e,
    shares: r.shares,
    why: [...why.values()],
    conflict: r.conflict,
    applied: r.applied,
    memoriesRead: loaded.memoriesRead,
    ...(loaded.degraded ? { degraded: loaded.degraded } : {}),
  };
}

async function saveShares(ctx: Ctx, expenseId: string, s: Record<string, Micro>, applied: { ruleId: string; target: 'expense' | number }[]) {
  await ctx.db.delete(shares).where(eq(shares.expenseId, expenseId));
  const rows = Object.entries(s).map(([memberId, usdcMicro]) => ({ expenseId, memberId, usdcMicro }));
  if (rows.length) await ctx.db.insert(shares).values(rows);
  await ctx.db.update(expenses).set({ applied }).where(eq(expenses.id, expenseId));
}

/** Adds a structured expense as a draft and proposes a split. */
export async function addExpense(
  ctx: Ctx,
  groupId: string,
  actorId: string,
  d: ExpenseDraft,
  opts: { source?: 'web' | 'telegram' | 'mcp' | 'seed' | 'eval'; rawText?: string } = {},
): Promise<AddResult> {
  await assertMember(ctx, groupId, actorId);
  const priced = await price(ctx, d);
  if ('fxUnavailable' in priced) return { ok: false, fxUnavailable: priced.fxUnavailable };
  const id = ctx.id();
  const e: Expense = {
    id,
    groupId,
    payerId: d.payerId,
    usdcMicro: priced.usdcMicro,
    currency: d.currency,
    amountMinor: d.amountMinor,
    category: d.category,
    items: priced.items,
    participants: d.participants,
    description: d.description,
    occurredAt: d.occurredAt,
  };
  await ctx.db.insert(expenses).values({
    id,
    groupId,
    payerId: e.payerId,
    description: e.description,
    category: e.category,
    currency: e.currency,
    amountMinor: e.amountMinor,
    fxRate: priced.fx.rate,
    fxSource: priced.fx.source,
    fxAt: new Date(priced.fx.at),
    usdcMicro: e.usdcMicro,
    participants: e.participants,
    items: itemsJson(e.items),
    status: 'draft',
    source: opts.source ?? 'web',
    rawText: opts.rawText ?? null,
    occurredAt: new Date(e.occurredAt),
    createdBy: actorId,
  });
  const p = await propose(ctx, e);
  await saveShares(ctx, id, p.shares, p.applied);
  return { ok: true, proposal: { ...p, draftId: id, fx: { rate: priced.fx.rate, source: priced.fx.source } } };
}

/** Parses a plain-words note, prices it and proposes a split. */
export async function addExpenseFromText(
  ctx: Ctx,
  groupId: string,
  actorId: string,
  text: string,
  opts: { source?: 'web' | 'telegram' | 'mcp' } = {},
): Promise<AddResult> {
  await assertMember(ctx, groupId, actorId);
  const g = await getGroup(ctx, groupId);
  const members = await groupMembers(ctx, groupId);
  const parsed = await parseExpense(ctx.llm, text, {
    members: members.map((m) => ({ id: m.id, name: m.name })),
    me: actorId,
    defaultCurrency: g.defaultCurrency,
    today: ctx.now().toISOString().slice(0, 10),
  });
  if (!parsed.ok) return { ok: false, missing: parsed.missing };
  return addExpense(ctx, groupId, actorId, parsed.draft, { ...opts, rawText: text });
}

async function loadExpense(ctx: Ctx, id: string): Promise<Row> {
  const [r] = await ctx.db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!r) throw new QuitsError('not_found', 'expense not found');
  return r;
}

export async function sharesOf(ctx: Ctx, expenseId: string): Promise<Record<string, Micro>> {
  const rows = await ctx.db.select().from(shares).where(eq(shares.expenseId, expenseId));
  return Object.fromEntries(rows.map((r) => [r.memberId, r.usdcMicro]));
}

/** Posts the draft with the split the member saw and writes it to the group's history. */
export async function accept(ctx: Ctx, draftId: string, actorId: string): Promise<{ expense: Expense; shares: Record<string, Micro> }> {
  const r = await loadExpense(ctx, draftId);
  await assertMember(ctx, r.groupId, actorId);
  if (r.status === 'posted') return { expense: rowToExpense(r), shares: await sharesOf(ctx, r.id) };
  if (r.status !== 'draft') throw new QuitsError('conflict', 'expense is not a draft');
  await ctx.db.update(expenses).set({ status: 'posted' }).where(eq(expenses.id, draftId));
  const e = rowToExpense(r);
  const s = await sharesOf(ctx, draftId);
  const members = await groupMembers(ctx, r.groupId);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const parts = Object.entries(s)
    .filter(([, v]) => v > 0n)
    .map(([m, v]) => `${name(m)} ${formatUsdc(v)}`)
    .join(', ');
  await enqueueMemory(ctx, {
    ns: nsGroupLog(r.groupId),
    kind: 'event',
    text: encodeMemory(`${name(e.payerId)} paid ${formatUsdc(e.usdcMicro)} USDC for ${e.description}; split ${parts}.`, {
      kind: 'event',
      event: 'expense',
      data: { expenseId: e.id, payer: e.payerId, usdcMicro: e.usdcMicro.toString(), rules: r.applied.map((a) => a.ruleId) },
    }),
  });
  return { expense: e, shares: s };
}

export type CorrectResult =
  | { ok: true; proposal: Proposal; learned: { ruleId: string; sentence: string; scope: 'group' | 'member' } }
  | { ok: false; clarify: string };

/** A member corrects a draft in plain words; Quits learns a rule and re-proposes right away. */
export async function correct(ctx: Ctx, draftId: string, actorId: string, text: string): Promise<CorrectResult> {
  const r = await loadExpense(ctx, draftId);
  await assertMember(ctx, r.groupId, actorId);
  if (r.status !== 'draft') throw new QuitsError('conflict', 'only drafts can be corrected');
  const e = rowToExpense(r);
  const members = await groupMembers(ctx, r.groupId);
  const c = await compileCorrection(ctx.llm, text, {
    expense: e,
    members: members.map((m) => ({ id: m.id, name: m.name })),
    now: ctx.now().toISOString(),
    newId: ctx.id,
  });
  const correctionId = ctx.id();
  if (!c.ok) {
    await ctx.db.insert(corrections).values({ id: correctionId, expenseId: draftId, userId: actorId, text, clarify: c.clarify });
    return { ok: false, clarify: c.clarify };
  }
  await learnRule(ctx, { rule: c.rule, scope: c.scope, sentence: c.sentence, groupId: r.groupId, createdBy: actorId, sourceExpenseId: draftId });
  await ctx.db.insert(corrections).values({ id: correctionId, expenseId: draftId, userId: actorId, text, ruleId: c.rule.id });
  await enqueueMemory(ctx, {
    ns: nsGroupLog(r.groupId),
    kind: 'event',
    text: encodeMemory(`Correction on ${e.description}: “${text.slice(0, 160)}”.`, {
      kind: 'event',
      event: 'correction',
      data: { expenseId: e.id, ruleId: c.rule.id, by: actorId },
    }),
  });
  const p = await propose(ctx, e);
  await saveShares(ctx, draftId, p.shares, p.applied);
  return {
    ok: true,
    proposal: { ...p, draftId, fx: r.fxRate ? { rate: r.fxRate, source: r.fxSource ?? '' } : null },
    learned: { ruleId: c.rule.id, sentence: c.sentence, scope: c.rule.kind === 'exclude' && c.scope === 'member' ? 'member' : 'group' },
  };
}

/** What Quits would have proposed for this expense using only what it knew at `asOf`. */
export async function replay(ctx: Ctx, expenseId: string, asOf: string) {
  const r = await loadExpense(ctx, expenseId);
  return propose(ctx, rowToExpense(r), { asOf });
}

export async function listExpenses(ctx: Ctx, groupId: string, opts: { includeDrafts?: boolean } = {}) {
  const rows = await ctx.db
    .select()
    .from(expenses)
    .where(opts.includeDrafts ? eq(expenses.groupId, groupId) : and(eq(expenses.groupId, groupId), eq(expenses.status, 'posted')))
    .orderBy(asc(expenses.occurredAt));
  const out = [];
  for (const r of rows) out.push({ expense: rowToExpense(r), status: r.status, shares: await sharesOf(ctx, r.id), applied: r.applied, source: r.source, fx: { rate: r.fxRate, source: r.fxSource } });
  return out;
}

export { rowToExpense };
