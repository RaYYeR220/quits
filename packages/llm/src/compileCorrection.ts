import { z } from 'zod';
import { CATEGORIES, CategorySchema, RuleSchema, TAGS, TagSchema, type Expense, type Member, type Rule } from '@quits/core';
import { formatUsdc } from '@quits/core';
import { askJson, type Llm } from './client.ts';

const nullish = <T extends z.ZodType>(t: T) => t.nullable().optional();

const Out = z.object({
  status: z.enum(['rule', 'once', 'clarify']),
  clarify: nullish(z.string()),
  once: nullish(
    z.object({
      absent: nullish(z.array(z.string())),
      payer: nullish(z.string()),
    }),
  ),
  scope: nullish(z.enum(['member', 'group'])),
  sentence: nullish(z.string()),
  rule: nullish(
    z.object({
      kind: z.enum(['exclude', 'only', 'weights', 'covers', 'payerExcluded', 'payerCovers']),
      member: nullish(z.string()),
      members: nullish(z.array(z.string())),
      weights: nullish(z.array(z.object({ member: z.string(), weight: z.number() }))),
      when: z.object({
        category: nullish(z.array(CategorySchema)),
        tags: nullish(z.array(TagSchema)),
        payer: nullish(z.string()),
      }),
      revoked: nullish(z.boolean()),
    }),
  ),
});

export interface CorrectionContext {
  expense: Expense;
  members: Member[];
  /** ISO timestamp the rule is learned at. */
  now: string;
  newId: () => string;
}

export type CompiledCorrection =
  | { ok: true; rule: Rule; scope: 'member' | 'group'; sentence: string }
  | { ok: true; once: { absent: string[]; payer?: string } }
  | { ok: false; clarify: string };

const SYSTEM = `A group splits shared expenses. A member just corrected how one expense was split.
First decide: is this a general habit that should apply to future expenses, or a fact about this one expense only?
- One-off facts ("Dan wasn't there", "actually Ben paid", "Clara left early") -> status "once" with once.absent (member ids who weren't part of it) and/or once.payer. Do not invent a rule for these.
- Habits and traits ("Ana doesn't drink", "rent goes by room size", "Ben always covers taxis") -> status "rule" with ONE rule.
Rule kinds:
- exclude {member, when}: the member pays nothing for matching expenses or items ("Ana doesn't drink" -> exclude ana when tags [alcohol]).
- only {members, when}: only these members share matching expenses or items.
- weights {weights: [{member, weight}], when}: split matching expenses in proportion ("rent by room size 40/20/20/20").
- covers {member, when}: that member always pays all of matching expenses ("Ben always covers taxis").
- payerExcluded {when}: whoever paid owes nothing for matching expenses.
- payerCovers {when}: whoever paid bears all of matching expenses or items ("personal stuff is on whoever bought it"). Prefer this over covers when the rule is about the buyer, not one named person.
when may set category (from: ${CATEGORIES.join(', ')}), tags (from: ${TAGS.join(', ')}), payer (a member id). Keep it as general as the person meant.
Set revoked: true when the person says an earlier rule no longer holds ("Ana drinks now").
scope is "member" for a personal trait that should follow the member to every group (diet, alcohol); otherwise "group".
sentence: one short plain sentence a person would write, stating the rule.
If you can't tell what rule they mean, status "clarify" with one short question. Use only member ids from the list.`;

function unknownMembers(rule: NonNullable<z.infer<typeof Out>['rule']>, ids: Set<string>): string[] {
  const named = [
    rule.member ?? null,
    ...(rule.members ?? []),
    ...(rule.weights ?? []).map((w) => w.member),
    rule.when.payer ?? null,
  ].filter((x): x is string => typeof x === 'string');
  return named.filter((m) => !ids.has(m));
}

export async function compileCorrection(llm: Llm, text: string, ctx: CorrectionContext): Promise<CompiledCorrection> {
  const e = ctx.expense;
  const roster = ctx.members.map((m) => `- ${m.id}: ${m.name}`).join('\n');
  const items = e.items.map((i) => `  - ${i.label} ${formatUsdc(i.usdcMicro)} USDC [${i.tags.join(', ')}]`).join('\n');
  const user = `Members:\n${roster}\n\nExpense: "${e.description}", category ${e.category}, paid by ${e.payerId}, total ${formatUsdc(e.usdcMicro)} USDC\n${items ? `Items:\n${items}\n` : ''}\n<correction>\n${text}\n</correction>`;
  const out = await askJson(llm, 'correction', SYSTEM, user, Out);

  const ids0 = new Set(ctx.members.map((m) => m.id));
  if (out.status === 'once' && out.once) {
    const absent = [...new Set(out.once.absent ?? [])];
    const payer = out.once.payer ?? undefined;
    const strangers = [...absent, ...(payer ? [payer] : [])].filter((m) => !ids0.has(m));
    if (strangers.length > 0) return { ok: false, clarify: `I don't know who "${strangers[0]}" is in this group. Who did you mean?` };
    if (absent.length === 0 && !payer) return { ok: false, clarify: 'What should change on this expense?' };
    return { ok: true, once: { absent, ...(payer ? { payer } : {}) } };
  }
  if (out.status === 'clarify' || !out.rule) {
    return { ok: false, clarify: out.clarify?.trim() || 'Could you say who this should apply to?' };
  }

  const ids = new Set(ctx.members.map((m) => m.id));
  const strangers = unknownMembers(out.rule, ids);
  if (strangers.length > 0) {
    return { ok: false, clarify: `I don't know who "${strangers[0]}" is in this group. Who did you mean?` };
  }

  const r = out.rule;
  const when = {
    ...(r.when.category?.length ? { category: [...new Set(r.when.category)] } : {}),
    ...(r.when.tags?.length ? { tags: [...new Set(r.when.tags)] } : {}),
    ...(r.when.payer ? { payer: r.when.payer } : {}),
  };
  const base = { v: 1 as const, id: ctx.newId(), learnedAt: ctx.now, when, ...(r.revoked ? { revoked: true } : {}) };
  const candidate =
    r.kind === 'exclude' || r.kind === 'covers'
      ? { ...base, kind: r.kind, member: r.member }
      : r.kind === 'only'
        ? { ...base, kind: r.kind, members: r.members }
        : r.kind === 'weights'
          ? { ...base, kind: r.kind, weights: Object.fromEntries((r.weights ?? []).map((w) => [w.member, w.weight])) }
          : { ...base, kind: r.kind as 'payerExcluded' | 'payerCovers' };

  const parsed = RuleSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, clarify: 'I couldn’t turn that into a rule. Could you say it another way?' };
  const rule = parsed.data;
  if (rule.kind === 'weights' && !Object.values(rule.weights).some((w) => w > 0)) {
    return { ok: false, clarify: 'What share should each person pay?' };
  }

  const personal = rule.kind === 'exclude' && !rule.when.payer;
  const scope = out.scope === 'member' && personal ? 'member' : 'group';
  const sentence = (out.sentence ?? '').trim() || text.trim();
  return { ok: true, rule, scope, sentence: sentence.slice(0, 200) };
}
