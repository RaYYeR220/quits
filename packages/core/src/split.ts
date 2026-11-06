import { allocate, sumMicro, type Micro } from './money.ts';
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

function latest(rs: Rule[]): Rule | undefined {
  return rs.reduce<Rule | undefined>((acc, r) => (!acc || r.learnedAt >= acc.learnedAt ? r : acc), undefined);
}

/**
 * Splits one expense among its participants, applying learned rules.
 *
 * The expense is cut into units: one per tagged line item plus the untagged
 * remainder. For each unit the matching rules apply in this order:
 * `covers` (one member takes it all) > `only` > `exclude` / `payerExcluded` > `weights` > equal.
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
  const applied: Applied[] = [];
  let conflict = false;

  for (const unit of units) {
    const hits = active.filter((r) => matches(r, e, unit));
    const used: Rule[] = [];
    let weights: Record<MemberId, number>;

    const cover = latest(hits.filter((r) => r.kind === 'covers' && present.has(r.member)));
    if (cover && cover.kind === 'covers') {
      weights = { [cover.member]: 1 };
      used.push(cover);
    } else {
      let set = new Set(people);
      const only = latest(hits.filter((r) => r.kind === 'only'));
      if (only && only.kind === 'only') {
        const narrowed = only.members.filter((m) => present.has(m));
        if (narrowed.length > 0) {
          set = new Set(narrowed);
          used.push(only);
        }
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

    const part = allocate(unit.amount, weights);
    for (const [m, v] of Object.entries(part)) shares[m] = (shares[m] ?? 0n) + v;
    for (const r of used) applied.push({ ruleId: r.id, target: unit.target });
  }

  return { shares, applied, conflict };
}
