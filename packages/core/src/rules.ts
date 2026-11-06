import { z } from 'zod';
import { CategorySchema, TagSchema } from './types.ts';

/** When a rule applies. Every set field must match; empty means "always". */
export const WhenSchema = z
  .object({
    category: z.array(CategorySchema).min(1).optional(),
    tags: z.array(TagSchema).min(1).optional(),
    payer: z.string().min(1).optional(),
  })
  .strict();
export type When = z.infer<typeof WhenSchema>;

const base = {
  v: z.literal(1),
  id: z.string().min(1),
  learnedAt: z.string().min(1),
  when: WhenSchema,
  /** A revocation removes the active rule with the same key. */
  revoked: z.boolean().optional(),
};

export const RuleSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('exclude'), member: z.string().min(1) }).strict(),
  z.object({ ...base, kind: z.literal('only'), members: z.array(z.string().min(1)).min(1) }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('weights'),
      weights: z.record(z.string().min(1), z.number().nonnegative()),
    })
    .strict(),
  z.object({ ...base, kind: z.literal('covers'), member: z.string().min(1) }).strict(),
  z.object({ ...base, kind: z.literal('payerExcluded') }).strict(),
  /** Whoever paid bears all of it ("personal stuff is on whoever bought it"). */
  z.object({ ...base, kind: z.literal('payerCovers') }).strict(),
]);
export type Rule = z.infer<typeof RuleSchema>;
export type RuleKind = Rule['kind'];

function normalizedWhen(w: When): string {
  return JSON.stringify({
    category: w.category ? [...w.category].sort() : null,
    tags: w.tags ? [...w.tags].sort() : null,
    payer: w.payer ?? null,
  });
}

/**
 * Identity of a rule for supersession. Two rules with the same key cannot both be
 * active; the one learned later wins. `exclude` is per member; `covers`, `only`,
 * `weights`, `payerExcluded` and `payerCovers` are per condition (a new coverer replaces the old one).
 */
export function ruleKey(r: Rule): string {
  const subject = r.kind === 'exclude' ? r.member : '';
  return `${r.kind}|${subject}|${normalizedWhen(r.when)}`;
}

/** Keeps the latest rule per key and drops keys whose latest entry is a revocation. */
export function supersede(rules: readonly Rule[]): Rule[] {
  const latest = new Map<string, Rule>();
  for (const r of rules) {
    const k = ruleKey(r);
    const cur = latest.get(k);
    if (!cur || r.learnedAt > cur.learnedAt || (r.learnedAt === cur.learnedAt && r.id > cur.id)) {
      latest.set(k, r);
    }
  }
  return [...latest.values()].filter((r) => !r.revoked).sort((a, b) => (a.learnedAt < b.learnedAt ? -1 : 1));
}

/** Members a rule talks about (used to skip rules for people who aren't in the expense). */
export function ruleMembers(r: Rule): string[] {
  switch (r.kind) {
    case 'exclude':
    case 'covers':
      return [r.member];
    case 'only':
      return r.members;
    case 'weights':
      return Object.keys(r.weights);
    case 'payerExcluded':
    case 'payerCovers':
      return [];
  }
}
