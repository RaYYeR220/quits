import { allocate, split, type Expense, type MemberId, type Micro, type Rule } from '@quits/core';
import { SAY_EVEN, hiddenRules, type GroupDef } from './groups.ts';
import { hash } from './rng.ts';

export type Shares = Record<MemberId, Micro>;

/** A member accepts a split when nobody is off by more than a cent. */
export const TOLERANCE: Micro = 10_000n;

/** The default of every split app: the total divided evenly among whoever was there. */
export function evenSplit(e: Expense): Shares {
  return allocate(e.usdcMicro, Object.fromEntries(e.participants.map((m) => [m, 1])));
}

/** How the group would split this expense if everyone remembered every habit. */
export function truth(e: Expense, g: GroupDef): Shares {
  return split(e, hiddenRules(g)).shares;
}

function keys(a: Shares, b: Shares): MemberId[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])];
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Σ|a − b| over everyone named in either split. */
export function distance(a: Shares, b: Shares): Micro {
  let d = 0n;
  for (const k of keys(a, b)) d += abs((a[k] ?? 0n) - (b[k] ?? 0n));
  return d;
}

export function isExact(p: Shares, t: Shares): boolean {
  return keys(p, t).every((k) => abs((p[k] ?? 0n) - (t[k] ?? 0n)) <= TOLERANCE);
}

/** Money that ends up on the wrong person: half the L1 distance. */
export function misallocated(p: Shares, t: Shares): Micro {
  return distance(p, t) / 2n;
}

/** Hidden rules that change who pays what on this expense, in the group's order. */
export function rulesAt(e: Expense, g: GroupDef): Rule[] {
  const used = new Set(split(e, hiddenRules(g)).applied.map((a) => a.ruleId));
  return hiddenRules(g).filter((r) => used.has(r.id));
}

function without(e: Expense, g: GroupDef, r: Rule): Shares {
  return split(e, hiddenRules(g).filter((x) => x.id !== r.id)).shares;
}

/**
 * A proposal reflects a rule when it sits closer to the true split than to the
 * split the group would get if that one habit didn't exist.
 */
export function reflects(p: Shares, e: Expense, g: GroupDef, r: Rule): boolean {
  return distance(p, truth(e, g)) < distance(p, without(e, g, r));
}

/** How much money one rule moves on this expense. */
function weight(e: Expense, g: GroupDef, r: Rule): Micro {
  return distance(truth(e, g), without(e, g, r));
}

export interface Pick {
  ruleId: string | 'even';
  text: string;
}

/**
 * The simulated member's next correction for a wrong proposal: one hidden rule
 * that applies here and that the proposal doesn't reflect yet, preferring one
 * they haven't raised on this expense and the one that moves the most money.
 * With no rule in play the split should simply be even, and they say so.
 * `invalid` proposals (nothing usable) count as reflecting nothing.
 */
export function nextCorrection(
  e: Expense,
  g: GroupDef,
  p: Shares | null,
  raisedHere: string[],
  o: { seed: number; n: number },
): Pick {
  const rules = rulesAt(e, g);
  const missing = rules.filter((r) => !p || !reflects(p, e, g, r));
  const byWeight = (rs: Rule[]) => [...rs].sort((a, b) => {
    const d = weight(e, g, b) - weight(e, g, a);
    return d === 0n ? rules.indexOf(a) - rules.indexOf(b) : d > 0n ? 1 : -1;
  });
  const fresh = (rs: Rule[]) => rs.filter((r) => !raisedHere.includes(r.id));

  const choice = byWeight(fresh(missing))[0] ?? byWeight(missing)[0] ?? byWeight(fresh(rules))[0] ?? byWeight(rules)[0];
  const ruleId = choice?.id ?? 'even';
  const say = choice ? (g.hidden.find((h) => h.rule.id === choice.id)?.say ?? []) : SAY_EVEN;
  const times = raisedHere.filter((x) => x === ruleId).length;
  const text = say[(hash(o.seed, g.id, o.n, ruleId) + times) % say.length] ?? '';
  return { ruleId, text };
}
