import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatUsdc } from '@quits/core';
import type { Llm } from '@quits/llm';
import { generate, toExpense, type EvalExpense } from './expenses.ts';
import { GROUPS, type GroupId } from './groups.ts';
import { metered, type Meter } from './llm.ts';
import { evenSplit, isExact, misallocated, nextCorrection, rulesAt, TOLERANCE, truth, type Shares } from './member.ts';
import { aggregate, aggregates, type Agg, type ExpenseRecord, type SharesJson, type SystemAggs } from './metrics.ts';
import { SYSTEM_BY_NAME, type Proposal, type Session, type SystemName } from './systems/index.ts';
import { quitsSession, quitsWorld } from './systems/quits.ts';

export const MAX_CORRECTIONS = 2;

/**
 * Extra runs beside the main table.
 * `trip-after-flat`: the same people first share the flat, then go on the trip,
 * all in one Quits deployment, so portable member rules carry over.
 */
export const SCENARIOS = ['trip-after-flat'] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export interface BenchOptions {
  systems: SystemName[];
  groups: GroupId[];
  scenarios?: ScenarioName[];
  weeks: number;
  perWeek: number;
  seed: number;
  llm: Llm;
  model: string;
  provider: string;
  /** How many system × group runs go at once. */
  concurrency: number;
  label?: string;
  /** The code being measured, captured before anything runs. */
  code?: { commit: string; dirty: string[] };
  log?: (line: string) => void;
}

export interface ScenarioAggs {
  system: SystemName;
  byGroup: Partial<Record<GroupId, { total: Agg; byWeek: Agg[] }>>;
}

export interface BenchResult {
  runId: string;
  label?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  config: {
    systems: SystemName[];
    groups: GroupId[];
    scenarios?: ScenarioName[];
    weeks: number;
    perWeek: number;
    seed: number;
    model: string;
    provider: string;
    toleranceUsd: string;
    maxCorrections: number;
    concurrency: number;
  };
  /** The code the run measured, when it ran from a git checkout. */
  code?: { commit: string; dirty: string[]; note?: string };
  groups: { id: GroupId; name: string; about: string; members: string[]; hidden: { id: string; rule: unknown; say: string[] }[] }[];
  totals: { llmCalls: number; llmErrors: number; promptTokens: number; completionTokens: number };
  aggregates: Partial<Record<SystemName, SystemAggs>>;
  scenarios?: Partial<Record<ScenarioName, ScenarioAggs>>;
  /** Set when several runs are rendered together: which run each system's numbers come from. */
  sources?: { what: string; runId: string; label?: string }[];
  records: ExpenseRecord[];
}

const DAY = 86_400_000;
const json = (s: Shares): SharesJson => Object.fromEntries(Object.entries(s).map(([m, v]) => [m, formatUsdc(v, 6)]));
const sharesOf = (p: Proposal): Shares | null => ('shares' in p ? p.shares : null);

/** The simulated member reviews one group's expenses, in order, with one system. */
async function review(
  session: Session,
  meter: Meter,
  name: SystemName,
  groupId: GroupId,
  xs: EvalExpense[],
  o: BenchOptions,
  scenario?: ScenarioName,
): Promise<ExpenseRecord[]> {
  const g = GROUPS[groupId];
  meter.take();
  const out: ExpenseRecord[] = [];

  for (const x of xs) {
    const e = toExpense(x);
    const t = truth(e, g);
    const started = performance.now();

    const first = await session.propose(x);
    let p = first;
    const raised: string[] = [];
    const corrections: ExpenseRecord['corrections'] = [];
    const exact = (q: Proposal) => 'shares' in q && isExact(q.shares, t);

    while (!exact(p) && corrections.length < MAX_CORRECTIONS) {
      const pick = nextCorrection(e, g, sharesOf(p), raised, { seed: o.seed, n: x.n });
      raised.push(pick.ruleId);
      const r = await session.correct(pick.text, x.payerId);
      p = r.proposal;
      corrections.push({
        ruleId: pick.ruleId,
        text: pick.text,
        exactAfter: exact(p),
        ...('invalid' in p ? { invalid: p.invalid } : {}),
        ...(r.note ? { note: r.note } : {}),
      });
    }

    const resolved = exact(p);
    const final = resolved && 'shares' in p ? p.shares : t;
    await session.settle(final, !resolved);
    const latencyMs = Math.round(performance.now() - started);
    const { calls, errors, prompt, completion } = meter.take();

    // an unusable answer leaves the member with the app's default, the even split
    const shown = sharesOf(first) ?? evenSplit(e);
    out.push({
      system: name,
      ...(scenario ? { scenario } : {}),
      group: groupId,
      week: x.week,
      n: x.n,
      expenseId: x.id,
      description: x.description,
      category: x.category,
      total: formatUsdc(e.usdcMicro, 6),
      rules: rulesAt(e, g).map((r) => r.id),
      truth: json(t),
      first: {
        shares: sharesOf(first) ? json(sharesOf(first)!) : null,
        ...('invalid' in first ? { invalid: first.invalid } : {}),
        exact: exact(first),
        misallocated: formatUsdc(misallocated(shown, t), 6),
      },
      corrections,
      finalExact: resolved,
      unresolved: !resolved,
      llm: { calls, errors, prompt, completion },
      latencyMs,
    });
    if ((x.n + 1) % 10 === 0) o.log?.(`  ${scenario ? `${scenario} ` : ''}${name} · ${groupId}: ${x.n + 1}/${xs.length}`);
  }
  return out;
}

async function runOne(name: SystemName, groupId: GroupId, xs: EvalExpense[], o: BenchOptions): Promise<ExpenseRecord[]> {
  const meter = metered(o.llm);
  const session = await SYSTEM_BY_NAME[name].start(GROUPS[groupId], meter.llm);
  return review(session, meter, name, groupId, xs, o);
}

/**
 * Ana, Ben, Clara and Dan share the flat for the benchmark's weeks, then the trip
 * (with Eve) starts, in the same deployment. The flat is moved back in time so the
 * trip keeps its usual dates and stays comparable with the main table.
 */
async function tripAfterFlat(o: BenchOptions): Promise<ExpenseRecord[]> {
  const opts = { weeks: o.weeks, perWeek: o.perWeek, seed: o.seed };
  const before = generate('flat', opts).map((x) => ({ ...x, occurredAt: new Date(Date.parse(x.occurredAt) - o.weeks * 7 * DAY).toISOString() }));
  const meter = metered(o.llm);
  const world = await quitsWorld(meter.llm, true);
  const flat = await review(await quitsSession(world, GROUPS.flat), meter, 'quits', 'flat', before, o, 'trip-after-flat');
  const trip = await review(await quitsSession(world, GROUPS.trip), meter, 'quits', 'trip', generate('trip', opts), o, 'trip-after-flat');
  return [...flat, ...trip];
}

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  return results;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function timed<T>(what: string, o: BenchOptions, f: () => Promise<T>): () => Promise<T> {
  return async () => {
    const t0 = Date.now();
    const r = await f();
    o.log?.(`done ${what} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return r;
  };
}

export async function runBench(o: BenchOptions): Promise<BenchResult> {
  const started = new Date();
  const scenarios = o.scenarios ?? [];
  const streams = Object.fromEntries(o.groups.map((g) => [g, generate(g, { weeks: o.weeks, perWeek: o.perWeek, seed: o.seed })])) as Record<GroupId, EvalExpense[]>;

  // slowest first, so the long runs overlap instead of trailing at the end
  const cost: SystemName[] = ['llm-full-history', 'llm-no-memory', 'quits-memory-off', 'quits', 'equal'];
  const order = [...o.systems].sort((a, b) => cost.indexOf(a) - cost.indexOf(b));
  const jobs = [
    ...scenarios.map((s) => timed(s, o, () => tripAfterFlat(o))),
    ...order.flatMap((s) => o.groups.map((g) => timed(`${s} · ${g}`, o, () => runOne(s, g, streams[g], o)))),
  ];
  const all = (await pool(jobs, o.concurrency)).flat();
  const rank = (r: ExpenseRecord) => (r.scenario ? 1 : 0);
  const records = all.sort(
    (a, b) => rank(a) - rank(b) || o.systems.indexOf(a.system) - o.systems.indexOf(b.system) || o.groups.indexOf(a.group) - o.groups.indexOf(b.group) || a.n - b.n,
  );
  const main = records.filter((r) => !r.scenario);

  const weekly = (xs: ExpenseRecord[]) => Array.from({ length: o.weeks }, (_, i) => aggregate(xs.filter((r) => r.week === i + 1)));
  const scenarioAggs = Object.fromEntries(
    scenarios.map((s) => {
      const xs = records.filter((r) => r.scenario === s);
      const byGroup = Object.fromEntries((['flat', 'trip'] as const).map((g) => [g, { total: aggregate(xs.filter((r) => r.group === g)), byWeek: weekly(xs.filter((r) => r.group === g)) }]));
      return [s, { system: 'quits' as const, byGroup }];
    }),
  );

  const finished = new Date();
  const sum = (f: (r: ExpenseRecord) => number) => records.reduce((s, r) => s + f(r), 0);
  return {
    runId: `${stamp(started)}-${o.model.replace(/[^a-z0-9.-]/gi, '_')}-s${o.seed}${o.label ? `-${o.label}` : ''}`,
    ...(o.label ? { label: o.label } : {}),
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    config: {
      systems: o.systems,
      groups: o.groups,
      ...(scenarios.length ? { scenarios } : {}),
      weeks: o.weeks,
      perWeek: o.perWeek,
      seed: o.seed,
      model: o.model,
      provider: o.provider,
      toleranceUsd: formatUsdc(TOLERANCE),
      maxCorrections: MAX_CORRECTIONS,
      concurrency: o.concurrency,
    },
    ...(o.code ? { code: o.code } : {}),
    groups: o.groups.map((id) => {
      const g = GROUPS[id];
      return { id, name: g.name, about: g.about, members: g.members.map((m) => m.id), hidden: g.hidden.map((h) => ({ id: h.rule.id, rule: h.rule, say: h.say })) };
    }),
    totals: {
      llmCalls: sum((r) => r.llm.calls),
      llmErrors: sum((r) => r.llm.errors),
      promptTokens: sum((r) => r.llm.prompt),
      completionTokens: sum((r) => r.llm.completion),
    },
    aggregates: aggregates(main, o.systems, o.groups, o.weeks),
    ...(scenarios.length ? { scenarios: scenarioAggs } : {}),
    records,
  };
}

export async function writeResults(r: BenchResult, dir: string, o: { latest: boolean }): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const text = `${JSON.stringify(r, null, 2)}\n`;
  const files = [join(dir, `${r.runId}.json`), ...(o.latest ? [join(dir, 'latest.json')] : [])];
  for (const f of files) await writeFile(f, text, 'utf8');
  return files;
}
