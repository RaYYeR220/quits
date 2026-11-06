import { formatUsdc } from '@quits/core';
import type { ScenarioName } from './bench.ts';
import type { GroupId } from './groups.ts';
import type { CorrectionNote, SystemName } from './systems/types.ts';

/** Amounts are decimal USD strings with 6 places (micro-USDC). */
export type SharesJson = Record<string, string>;

export interface ExpenseRecord {
  system: SystemName;
  /** Set for records of a side scenario; those stay out of the main aggregates. */
  scenario?: ScenarioName;
  group: GroupId;
  week: number;
  n: number;
  expenseId: string;
  description: string;
  category: string;
  total: string;
  /** Hidden rules that change this expense's split. */
  rules: string[];
  truth: SharesJson;
  first: { shares: SharesJson | null; invalid?: string; exact: boolean; misallocated: string };
  corrections: { ruleId: string; text: string; exactAfter: boolean; invalid?: string; note?: CorrectionNote }[];
  /** Right after the member's corrections, before any hand fix. */
  finalExact: boolean;
  /** Still wrong after the last allowed correction; the member fixed it by hand. */
  unresolved: boolean;
  llm: { calls: number; errors: number; prompt: number; completion: number };
  latencyMs: number;
}

export interface Agg {
  expenses: number;
  firstTryExact: number;
  firstTryExactPct: number;
  corrections: number;
  correctionsPer10: number;
  /** Σ over expenses of Σ|first proposal − truth| / 2, in USD. */
  misallocatedUsd: string;
  unresolved: number;
  invalidFirst: number;
  /** Corrections Quits took as a one-off fact about the expense instead of a habit. */
  oneOffFixes: number;
  llmCalls: number;
  llmErrors: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerExpense: number;
  promptTokensPerExpense: number;
  latencyMsMean: number;
}

const micro = (usd: string): bigint => {
  const [w = '0', f = ''] = usd.split('.');
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, '0').slice(0, 6));
};

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function aggregate(rs: ExpenseRecord[]): Agg {
  const n = rs.length;
  const per = (v: number) => (n ? v / n : 0);
  const sum = (f: (r: ExpenseRecord) => number) => rs.reduce((s, r) => s + f(r), 0);
  const firstTryExact = rs.filter((r) => r.first.exact).length;
  const corrections = sum((r) => r.corrections.length);
  const prompt = sum((r) => r.llm.prompt);
  const completion = sum((r) => r.llm.completion);
  return {
    expenses: n,
    firstTryExact,
    firstTryExactPct: round(per(firstTryExact) * 100, 1),
    corrections,
    correctionsPer10: round(per(corrections) * 10, 2),
    misallocatedUsd: formatUsdc(rs.reduce((s, r) => s + micro(r.first.misallocated), 0n)),
    unresolved: rs.filter((r) => r.unresolved).length,
    invalidFirst: rs.filter((r) => r.first.invalid !== undefined).length,
    oneOffFixes: sum((r) => r.corrections.filter((c) => c.note?.fixed).length),
    llmCalls: sum((r) => r.llm.calls),
    llmErrors: sum((r) => r.llm.errors),
    promptTokens: prompt,
    completionTokens: completion,
    tokensPerExpense: Math.round(per(prompt + completion)),
    promptTokensPerExpense: Math.round(per(prompt)),
    latencyMsMean: Math.round(per(sum((r) => r.latencyMs))),
  };
}

export interface SystemAggs {
  total: Agg;
  byWeek: Agg[];
  byGroup: Partial<Record<GroupId, { total: Agg; byWeek: Agg[] }>>;
}

export function aggregates(rs: ExpenseRecord[], systems: SystemName[], groups: GroupId[], weeks: number): Partial<Record<SystemName, SystemAggs>> {
  const weekly = (xs: ExpenseRecord[]) => Array.from({ length: weeks }, (_, i) => aggregate(xs.filter((r) => r.week === i + 1)));
  return Object.fromEntries(
    systems.map((s) => {
      const mine = rs.filter((r) => r.system === s);
      const byGroup = Object.fromEntries(
        groups.map((g) => {
          const gs = mine.filter((r) => r.group === g);
          return [g, { total: aggregate(gs), byWeek: weekly(gs) }];
        }),
      );
      return [s, { total: aggregate(mine), byWeek: weekly(mine), byGroup }];
    }),
  );
}
