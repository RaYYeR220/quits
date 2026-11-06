// Renders the benchmark numbers in README.md from eval/results/*.json.
// Nothing between the markers is typed by hand.
//   tsx scripts/render-readme.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mergeRuns } from '../eval/src/report.ts';

type Agg = {
  firstTryExactPct: number;
  correctionsPer10: number;
  misallocatedUsd: string;
  unresolved: number;
  tokensPerExpense: number;
  latencyMsMean: number;
  expenses: number;
};
type Run = {
  runId: string;
  label?: string;
  config: { seed: number; model: string };
  aggregates: Record<string, { total: Agg; byWeek: Agg[] }>;
};

const dir = 'eval/results';
const load = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'latest.json');
const byLabel = (label: string) => files.filter((f) => f.endsWith(`-${label}.json`)).sort().at(-1);
const v1 = files.filter((f) => /-mercury-3-s\d+\.json$/.test(f)).sort()[0];
const v2 = byLabel('v2');
if (!v1 || !v2) throw new Error('need the v1 and v2 runs in eval/results');

const main = mergeRuns([load(v1), load(v2)]) as unknown as Run;
const heldoutFile = byLabel('heldout');
const heldoutV3File = byLabel('heldout-v3');
const v3File = byLabel('v3');
const freshFirstFile = byLabel('fresh');
// the same seed again after splitting moved to whole cents; when present it is the headline
const freshFile = byLabel('fresh-cents') ?? freshFirstFile;
const heldout = heldoutFile ? (load(heldoutFile) as Run) : null;
const heldoutV3 = heldout && heldoutV3File ? (mergeRuns([load(heldoutFile!), load(heldoutV3File)]) as unknown as Run) : null;
const fresh = freshFile ? (load(freshFile) as Run) : null;

const names: Record<string, string> = {
  equal: 'Even split (what split apps do)',
  'llm-no-memory': 'LLM, no memory',
  'llm-full-history': 'LLM with the whole group history in the prompt',
  quits: '**Quits**',
  'quits-memory-off': 'Quits with memory switched off',
};
const order = ['equal', 'llm-no-memory', 'llm-full-history', 'quits', 'quits-memory-off'];
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
const usd = (s: string) => `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function table(r: Run, systems: string[]): string {
  const rows = systems
    .filter((s) => r.aggregates[s])
    .map((s) => {
      const t = r.aggregates[s]!.total;
      return `| ${names[s] ?? s} | ${t.firstTryExactPct.toFixed(1)}% | ${t.correctionsPer10.toFixed(2)} | ${usd(t.misallocatedUsd)} | ${t.unresolved} | ${t.tokensPerExpense.toLocaleString('en-US')} | ${ms(t.latencyMsMean)} |`;
    });
  return [
    '| | Right the first time | Corrections per 10 bills | Misallocated if nobody corrected | Still wrong after 2 corrections | Model tokens per bill | Time per bill |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

function weeks(r: Run, systems: string[]): string {
  const rows = systems
    .filter((s) => r.aggregates[s])
    .map((s) => `| ${names[s] ?? s} | ${[0, 1, 2, 3].map((w) => { const a = r.aggregates[s]!.byWeek[w]; return a ? `${a.firstTryExactPct.toFixed(0)}% · ${a.correctionsPer10.toFixed(1)} corr.` : '–'; }).join(' | ')} |`);
  return ['| Right the first time · corrections per 10, by week | Week 1 | Week 2 | Week 3 | Week 4 |', '| --- | ---: | ---: | ---: | ---: |', ...rows].join('\n');
}

// The headline is the newest run on bills nobody looked at while building: seed `fresh`, else the held-out seed.
const head = fresh ?? heldoutV3 ?? heldout ?? main;
const eq = head.aggregates.equal!.total;
const q = head.aggregates.quits!.total;
const fh = head.aggregates['llm-full-history']!.total;
const pct = (n: number) => `${n.toFixed(1)}%`;
/** One paragraph, every number computed, no adjective chosen by hand. */
function summary(): string {
  const n = q.expenses;
  const diff = Math.round(((fh.firstTryExactPct - q.firstTryExactPct) * n) / 100);
  const gap = diff === 0 ? 'the same number of bills' : `${Math.abs(diff)} bill${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'more' : 'fewer'} out of ${n}`;
  return [
    `Even splits put **${usd(eq.misallocatedUsd)}** in the wrong pocket over the month.`,
    `Quits gets ${pct(q.firstTryExactPct)} of bills right the first time; an LLM that re-reads the whole group history gets ${pct(fh.firstTryExactPct)} (${gap}).`,
    `Quits needs ${q.correctionsPer10.toFixed(2)} corrections per 10 bills to the prompt's ${fh.correctionsPer10.toFixed(2)}, and leaves ${usd(q.misallocatedUsd)} misallocated to its ${usd(fh.misallocatedUsd)}.`,
    `The difference is cost: **${Math.round(fh.tokensPerExpense / q.tokensPerExpense)}× fewer model tokens** and **${Math.round(fh.latencyMsMean / q.latencyMsMean)}× faster**, because the model only runs when someone corrects a split, and every answer names the rule and the memory behind it.`,
  ].join(' ');
}

const lines = [
  `Three simulated groups (a flat of four, a trip of five, a couple), four weeks, 40 bills each, ${head.config.model}. A simulated member corrects a wrong split in plain words, up to twice per bill. "Right" means every share within $0.01.${head !== main ? ` These bills come from seed ${head.config.seed}, which nothing in Quits was tuned on.` : ''} Method and caveats: [eval/README.md](eval/README.md).`,
  '',
  table(head, head !== main ? ['equal', 'llm-full-history', 'quits'] : order),
  '',
  weeks(head, ['llm-full-history', 'quits']),
  '',
  summary(),
];

// Same people, second group: the trip after the flat, members' own rules carried over.
type Scen = { byGroup: Record<string, { total: Agg; byWeek: Agg[] }> };
const portable = (r: Run & { scenarios?: Record<string, Scen> }) => {
  const carried = r.scenarios?.['trip-after-flat']?.byGroup.trip;
  const cold = (r.aggregates.quits as unknown as Scen | undefined)?.byGroup?.trip;
  return carried && cold ? { carried, cold } : null;
};
const port = portable(head as Run & { scenarios?: Record<string, Scen> });
if (port) {
  const w1 = (x: { byWeek: Agg[] }) => pct(x.byWeek[0]!.firstTryExactPct);
  const fhTrip = (head.aggregates['llm-full-history'] as unknown as Scen | undefined)?.byGroup?.trip;
  lines.push(
    '',
    `**Memory that follows people.** When Ana, Ben, Clara and Dan start the trip after a month in the flat, the habits they taught about themselves come with them: the trip's first week is right ${w1(port.carried)} of the time, against ${w1(port.cold)} for the same trip started from nothing, and the trip needs ${port.carried.total.correctionsPer10.toFixed(2)} corrections per 10 bills instead of ${port.cold.total.correctionsPer10.toFixed(2)}.${fhTrip ? ` A prompt holding one group's history starts every new group empty (${w1(fhTrip)} in the trip's first week).` : ''}`,
  );
}

// Every run, oldest first, so the changes between them are visible.
const history: { file: string | undefined; what: string; run: Run | null }[] = [
  { file: v1, what: 'first run', run: load(v1) as Run },
  { file: v2, what: 'Quits rerun after adding the "whoever bought it pays" rule kind', run: load(v2) as Run },
  { file: heldoutFile, what: 'new seed, code frozen', run: heldout },
  { file: heldoutV3File, what: 'Quits rerun after two correction fixes found in the first seed', run: heldoutV3File ? (load(heldoutV3File) as Run) : null },
  { file: freshFirstFile, what: 'third seed, all systems', run: freshFirstFile ? (load(freshFirstFile) as Run) : null },
  { file: freshFile !== freshFirstFile ? freshFile : undefined, what: 'same seed, after shares moved to whole cents', run: freshFile !== freshFirstFile ? fresh : null },
];
const rows = history
  .filter((h) => h.file && h.run)
  .map((h) => {
    const r = h.run!;
    const cell = (s: string) => (r.aggregates[s] ? `${pct(r.aggregates[s]!.total.firstTryExactPct)} · ${r.aggregates[s]!.total.correctionsPer10.toFixed(2)}` : '–');
    return `| [${r.runId}](eval/results/${h.file}) | ${r.config.seed} | ${h.what} | ${cell('llm-full-history')} | ${cell('quits')} |`;
  });
lines.push(
  '',
  '<details><summary>Every run so far</summary>',
  '',
  '| Run | Seed | What changed | Whole-history LLM: right first time · corrections/10 | Quits |',
  '| --- | ---: | --- | ---: | ---: |',
  ...rows,
  '',
  `The first seed (${main.config.seed}) is where the rule language was shaped, so it is not a fair test; it also holds the two controls (the same LLM with no history, and Quits with memory switched off):`,
  '',
  table(main, order),
  '',
  '</details>',
);
const block = lines.join('\n');

// One line under the title, also computed: what even splits cost, and how often Quits was right once taught.
const later = (head.aggregates.quits!.byWeek as (Agg & { firstTryExact?: number })[]).slice(1);
const laterRight = later.reduce((n, w) => n + (w.firstTryExact ?? Math.round((w.firstTryExactPct * w.expenses) / 100)), 0);
const laterAll = later.reduce((n, w) => n + w.expenses, 0);
const hook = `In a month of simulated group bills, even splits put **${usd(eq.misallocatedUsd)}** in the wrong pocket. After its first week, Quits split ${laterRight} of ${laterAll} bills right the first time, using ${Math.round(fh.tokensPerExpense / q.tokensPerExpense)}× fewer model tokens than an LLM re-reading the group's history. [How we measured](#does-it-actually-learn)`;

let readme = readFileSync('README.md', 'utf8');
const h0 = '<!-- headline:start -->';
const h1 = '<!-- headline:end -->';
if (readme.includes(h0) && readme.includes(h1)) readme = `${readme.slice(0, readme.indexOf(h0) + h0.length)}\n${hook}\n${readme.slice(readme.indexOf(h1))}`;
const start = '<!-- results:start -->';
const end = '<!-- results:end -->';
const a = readme.indexOf(start);
const b = readme.indexOf(end);
if (a < 0 || b < 0) throw new Error('README.md has no results markers');
writeFileSync('README.md', `${readme.slice(0, a + start.length)}\n${block}\n${readme.slice(b)}`);
console.log(`README results updated; headline ${head.runId}`);
if (existsSync('README.md')) console.log(`headline: even split ${usd(eq.misallocatedUsd)} misallocated; quits ${q.firstTryExactPct}% vs full history ${fh.firstTryExactPct}%`);
