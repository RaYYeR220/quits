import type { BenchResult, ScenarioAggs } from './bench.ts';
import type { Agg, ExpenseRecord, SystemAggs } from './metrics.ts';
import { SYSTEMS } from './systems/types.ts';

type Col = { head: string; cell: (a: Agg) => string };

const pct = (a: Agg) => `${a.firstTryExactPct.toFixed(1)}%`;
const per10 = (a: Agg) => a.correctionsPer10.toFixed(2);
const usd = (a: Agg) => {
  const [whole = '0', cents = '00'] = a.misallocatedUsd.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
};
const tokens = (a: Agg) => a.tokensPerExpense.toLocaleString('en-US');
const latency = (a: Agg) => (a.latencyMsMean >= 1000 ? `${(a.latencyMsMean / 1000).toFixed(1)} s` : `${a.latencyMsMean} ms`);

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map((_, i) => (i === 0 ? '---' : '---:'))), ...rows.map(line)].join('\n');
}

function weekly(r: BenchResult, pick: (s: SystemAggs) => { total: Agg; byWeek: Agg[] } | undefined, cell: (a: Agg) => string): string {
  const weeks = Array.from({ length: r.config.weeks }, (_, i) => `Week ${i + 1}`);
  const rows = r.config.systems.flatMap((s) => {
    const a = r.aggregates[s];
    const p = a && pick(a);
    return p ? [[`\`${s}\``, ...p.byWeek.map(cell), cell(p.total)]] : [];
  });
  return table(['System', ...weeks, 'All'], rows);
}

function totals(r: BenchResult, pick: (s: SystemAggs) => Agg | undefined, cols: Col[]): string {
  const rows = r.config.systems.flatMap((s) => {
    const a = r.aggregates[s];
    const t = a && pick(a);
    return t ? [[`\`${s}\``, ...cols.map((c) => c.cell(t))]] : [];
  });
  return table(['System', ...cols.map((c) => c.head)], rows);
}

const COLS: Col[] = [
  { head: 'First-try exact', cell: pct },
  { head: 'Corrections / 10 expenses', cell: per10 },
  { head: '$ misallocated if uncorrected', cell: usd },
  { head: 'Unresolved after 2 corrections', cell: (a) => String(a.unresolved) },
  { head: 'Unusable answers', cell: (a) => String(a.invalidFirst) },
  { head: 'LLM tokens / expense', cell: tokens },
  { head: 'of which prompt', cell: (a) => a.promptTokensPerExpense.toLocaleString('en-US') },
  { head: 'Latency / expense', cell: latency },
];

function header(r: BenchResult): string {
  const c = r.config;
  const setup = `model \`${c.model}\` (${c.provider}) · seed ${c.seed} · ${c.groups.length} groups × ${c.weeks} weeks × ${c.perWeek} expenses (${c.weeks * c.perWeek} per group) · exact means every share within $${c.toleranceUsd} · up to ${c.maxCorrections} corrections per expense`;
  if (!r.sources) {
    const cost = `${(r.durationMs / 60000).toFixed(1)} min, ${r.totals.llmCalls.toLocaleString('en-US')} LLM calls, ${(r.totals.promptTokens + r.totals.completionTokens).toLocaleString('en-US')} tokens`;
    return `Run \`${r.runId}\`${r.label ? ` (${r.label})` : ''} · ${setup} · ${cost}`;
  }
  const byRun = new Map<string, { label?: string; what: string[] }>();
  for (const s of r.sources) {
    const e = byRun.get(s.runId) ?? { ...(s.label ? { label: s.label } : {}), what: [] };
    e.what.push(`\`${s.what}\``);
    byRun.set(s.runId, e);
  }
  const runs = [...byRun].map(([id, e]) => `${e.label ? `${e.label} ` : ''}\`${id}\` for ${e.what.join(', ')}`);
  return `Runs: ${runs.join('; ')} · ${setup}`;
}

function scenarioSection(r: BenchResult, sc: ScenarioAggs): string[] {
  const warm = sc.byGroup.trip;
  const rows: [string, { total: Agg; byWeek: Agg[] } | undefined][] = [
    ['`quits` after the flat', warm],
    ['`quits` cold (main table)', r.aggregates.quits?.byGroup.trip],
    ['`llm-full-history` (trip history only)', r.aggregates['llm-full-history']?.byGroup.trip],
  ];
  const cols: Col[] = [
    { head: 'Trip first-try exact, all weeks', cell: pct },
    { head: 'Corrections / 10 expenses', cell: per10 },
    { head: '$ misallocated if uncorrected', cell: usd },
    { head: 'Unresolved after 2 corrections', cell: (a) => String(a.unresolved) },
    { head: 'LLM tokens / expense', cell: tokens },
  ];
  const body = rows.flatMap(([name, a]) => {
    const w1 = a?.byWeek[0];
    return a && w1 ? [[name, pct(w1), String(w1.corrections), ...cols.map((c) => c.cell(a.total))]] : [];
  });
  const flat = sc.byGroup.flat?.total;
  return [
    '\n**Same people, second group** (`trip-after-flat`)\n',
    `Ana, Ben, Clara and Dan share the flat for ${r.config.weeks} weeks, then go on the trip with Eve, all in one Quits deployment, so the portable rules Ana and Clara taught in the flat come along. The trip expenses are the same as in the main table. \`llm-full-history\` keeps one history per group, as such a tool would.${flat ? ` In the flat part of this run Quits got ${pct(flat)} first try.` : ''}\n`,
    table(['System', 'Trip week 1 first-try exact', 'Trip week 1 corrections', ...cols.map((c) => c.head)], body),
  ];
}

/** Markdown tables for the README, straight from a results file (or several, see `mergeRuns`). */
export function renderMarkdown(r: BenchResult): string {
  const out: string[] = [];
  if (r.config.model === 'fake') out.push('> Offline run with the scripted stand-in model. It checks the harness; these numbers are not a result.\n');
  out.push(header(r));
  out.push('\n**Totals, all groups**\n', totals(r, (a) => a.total, COLS));
  for (const s of ['quits', 'quits-memory-off'] as const) {
    const t = r.aggregates[s]?.total;
    if (t && t.corrections > 0)
      out.push(`\n\`${s}\` took ${t.oneOffFixes} of its ${t.corrections} corrections as a one-off fact about that expense rather than a habit, and learned nothing from those.`);
  }
  out.push('\n**First-try exact, by week (all groups)**\n', weekly(r, (a) => a, pct));
  out.push('\n**Corrections per 10 expenses, by week (all groups)**\n', weekly(r, (a) => a, per10));
  out.push('\n**$ misallocated if nobody corrected, by week (all groups)**\n', weekly(r, (a) => a, usd));
  out.push('\n**LLM tokens per expense, by week (all groups)**\n', weekly(r, (a) => a, tokens));
  for (const g of r.groups) {
    out.push(`\n**${g.name}** (\`${g.id}\`, ${g.members.length} people): first-try exact by week\n`, weekly(r, (a) => a.byGroup[g.id], pct));
    out.push('\n', totals(r, (a) => a.byGroup[g.id]?.total, COLS));
  }
  const sc = r.scenarios?.['trip-after-flat'];
  if (sc) out.push(...scenarioSection(r, sc));
  return `${out.join('\n')}\n`;
}

/**
 * Several runs as one report: each system's numbers come from the last run that
 * has it, the scenario from the last run that has one. Refuses runs that aren't
 * comparable (different seed, model, size or groups).
 */
export function mergeRuns(runs: BenchResult[]): BenchResult {
  const [first] = runs;
  if (!first) throw new Error('mergeRuns: no runs');
  if (runs.length === 1) return first;
  const key = (r: BenchResult) =>
    JSON.stringify([r.config.seed, r.config.model, r.config.weeks, r.config.perWeek, r.config.maxCorrections, r.config.toleranceUsd, [...r.config.groups].sort()]);
  const odd = runs.find((r) => key(r) !== key(first));
  if (odd) throw new Error(`mergeRuns: ${odd.runId} is not comparable with ${first.runId} (seed, model, size and groups must match)`);

  const last = <T>(f: (r: BenchResult) => T | undefined) => [...runs].reverse().find((r) => f(r) !== undefined);
  const systems = SYSTEMS.filter((s) => runs.some((r) => r.aggregates[s]));
  const pick = Object.fromEntries(systems.map((s) => [s, last((r) => r.aggregates[s])!]));
  const scenarioRun = last((r) => r.scenarios);
  const records: ExpenseRecord[] = [
    ...systems.flatMap((s) => pick[s]!.records.filter((x) => x.system === s && !x.scenario)),
    ...(scenarioRun?.records.filter((x) => x.scenario) ?? []),
  ];
  const sum = (f: (x: ExpenseRecord) => number) => records.reduce((a, x) => a + f(x), 0);
  const tag = (r: BenchResult) => ({ runId: r.runId, ...(r.label ? { label: r.label } : {}) });
  // per-run fields (label, code, timing) don't describe a merge; `sources` does
  const { label: _label, code: _code, ...base } = first;

  return {
    ...base,
    runId: runs.map((r) => r.runId).join('+'),
    config: { ...first.config, systems, ...(scenarioRun?.config.scenarios ? { scenarios: scenarioRun.config.scenarios } : {}) },
    totals: {
      llmCalls: sum((x) => x.llm.calls),
      llmErrors: sum((x) => x.llm.errors),
      promptTokens: sum((x) => x.llm.prompt),
      completionTokens: sum((x) => x.llm.completion),
    },
    aggregates: Object.fromEntries(systems.map((s) => [s, pick[s]!.aggregates[s]])),
    ...(scenarioRun?.scenarios ? { scenarios: scenarioRun.scenarios } : {}),
    sources: [
      ...systems.map((s) => ({ what: s, ...tag(pick[s]!) })),
      ...(scenarioRun?.config.scenarios ?? []).map((s) => ({ what: s, ...tag(scenarioRun!) })),
    ],
    records,
  };
}
