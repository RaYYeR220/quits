import { apportion, exactParts, sumMicro, type Micro } from './money.ts';
import { supersede, type Rule } from './rules.ts';
import type { Expense, MemberId, Tag } from './types.ts';

export interface Applied {
  ruleId: string;
  /** `'expense'` for the untagged remainder, or the index of the item the rule touched. */
  target: 'expense' | number;
}

export interface SplitResult {
  shares: Record<MemberId, Micro>;
  applied: Applied[];
  /** True when the rules left nobody to pay a part and that part fell back to an equal split. */
  conflict: boolean;
}

interface Unit {
  amount: Micro;
  tags: Tag[];
  target: 'expense' | number;
}

function matches(r: Rule, e: Expense, unit: Unit): boolean {
  const w = r.when;
  if (w.category && !w.category.includes(e.category)) return false;
  if (w.payer && w.payer !== e.payerId) return false;
  if (w.tags && !w.tags.some((t) => unit.tags.includes(t))) return false;
  return true;
}

function specificity(r: Rule): number {
  return (r.when.category ? 1 : 0) + (r.when.tags ? 1 : 0) + (r.when.payer ? 1 : 0);
}

function mostSpecific(rs: Rule[]): Rule | undefined {
  return rs.reduce<Rule | undefined>((best, r) => {
    if (!best) return r;
    const a = specificity(r);
    const b = specificity(best);
    return a > b || (a === b && r.learnedAt >= best.learnedAt) ? r : best;
  }, undefined);
}

function latest(rs: Rule[]): Rule | undefined {
  return rs.reduce<Rule | undefined>((acc, r) => (!acc || r.learnedAt >= acc.learnedAt ? r : acc), undefined);
}

/**
 * Splits one expense among its participants, applying learned rules.
 *
 * The expense is cut into units: one per tagged line item plus the untagged
 * remainder. For each unit, the routing rules (`covers`: one member takes it all,
 * `payerCovers`: the payer does, `only`: a named subset shares it) compete and the
 * most specific matching one wins (ties: the newest). Then `exclude` / `payerExcluded`
 * narrow the set, `weights` divide it, otherwise it is split equally.
 * Rules naming people who aren't participants are ignored. If the rules leave
 * nobody to pay a unit, that unit is split equally and `conflict` is set.
 */
export function split(e: Expense, rules: readonly Rule[]): SplitResult {
  const people = [...new Set(e.participants)].sort();
  if (people.length === 0) throw new Error('split: expense has no participants');
  const itemSum = sumMicro(e.items.map((i) => i.usdcMicro));
  if (itemSum > e.usdcMicro) throw new Error('split: items add up to more than the total');

  const present = new Set(people);
  const active = supersede(rules);

  const units: Unit[] = e.items
    .map((it, i): Unit => ({ amount: it.usdcMicro, tags: it.tags, target: i }))
    .filter((un) => un.amount > 0n);
  const remainder = e.usdcMicro - itemSum;
  if (remainder > 0n || units.length === 0) units.push({ amount: remainder, tags: [], target: 'expense' });

  const shares: Record<MemberId, Micro> = Object.fromEntries(people.map((p) => [p, 0n]));
  const exact: Record<MemberId, bigint> = {};
  const applied: Applied[] = [];
  let conflict = false;

  for (const unit of units) {
    const hits = active.filter((r) => matches(r, e, unit));
    const used: Rule[] = [];
    let weights: Record<MemberId, number>;

    // Rules that decide who carries the unit (one member, the payer, or a named subset):
    // the most specific one wins, and among equally specific ones the newest.
    const routing = hits.filter(
      (r) =>
        (r.kind === 'covers' && present.has(r.member)) ||
        (r.kind === 'payerCovers' && present.has(e.payerId)) ||
        (r.kind === 'only' && r.members.some((m) => present.has(m))),
    );
    const route = mostSpecific(routing);
    if (route?.kind === 'covers') {
      weights = { [route.member]: 1 };
      used.push(route);
    } else if (route?.kind === 'payerCovers') {
      weights = { [e.payerId]: 1 };
      used.push(route);
    } else {
      let set = new Set(people);
      if (route?.kind === 'only') {
        set = new Set(route.members.filter((m) => present.has(m)));
        used.push(route);
      }
      for (const r of hits) {
        if (r.kind === 'exclude' && set.has(r.member)) {
          set.delete(r.member);
          used.push(r);
        } else if (r.kind === 'payerExcluded' && set.has(e.payerId)) {
          set.delete(e.payerId);
          used.push(r);
        }
      }
      if (set.size === 0) {
        conflict = true;
        used.length = 0;
        set = new Set(people);
      }
      const members = [...set].sort();
      const wr = latest(hits.filter((r) => r.kind === 'weights'));
      const ws = wr && wr.kind === 'weights' ? members.map((m) => wr.weights[m] ?? 0) : [];
      if (wr && wr.kind === 'weights' && ws.some((w) => w > 0)) {
        weights = Object.fromEntries(members.map((m, i) => [m, ws[i] ?? 0]));
        used.push(wr);
      } else {
        weights = Object.fromEntries(members.map((m) => [m, 1]));
      }
    }

    // carry each line's exact parts and round once at the end, so the shares add up to the bill in whole cents
    for (const [m, v] of Object.entries(exactParts(unit.amount, weights))) exact[m] = (exact[m] ?? 0n) + v;
    for (const r of used) applied.push({ ruleId: r.id, target: unit.target });
  }

  const total = Object.values(exact).length ? sumMicro(units.map((u) => u.amount)) : 0n;
  Object.assign(shares, apportion(total, exact));
  return { shares, applied, conflict };
}
