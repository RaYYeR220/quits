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
const v1 = files.find((f) => f.includes('-mercury-3-') && !f.includes('-v2') && !f.includes('heldout'));
const v2 = files.find((f) => f.includes('-v2'));
const held = files.find((f) => f.includes('heldout'));
if (!v1 || !v2) throw new Error('need the v1 and v2 runs in eval/results');

const main = mergeRuns([load(v1), load(v2)]) as unknown as Run;
const heldout = held ? (load(held) as Run) : null;

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

const eq = main.aggregates.equal!.total;
const q = main.aggregates.quits!.total;
const fh = main.aggregates['llm-full-history']!.total;
const q1 = Number(main.aggregates.quits!.byWeek[0]?.misallocatedUsd ?? 0);
const week1Share = Number(q.misallocatedUsd) > 0 ? Math.round((q1 / Number(q.misallocatedUsd)) * 100) : 0;
const lines = [
  `Three simulated groups (a flat of four, a trip of five, a couple), four weeks, 40 bills each, ${main.config.model}, seed ${main.config.seed}. A simulated member corrects a wrong split in plain words, up to twice per bill. "Right" means every share within $0.01. Full method and caveats: [eval/README.md](eval/README.md).`,
  '',
  table(main, order),
  '',
  weeks(main, ['llm-full-history', 'quits']),
  '',
  `Even splits put **${usd(eq.misallocatedUsd)}** in the wrong pocket over the month. Quits ended at ${usd(q.misallocatedUsd)} (${week1Share === 100 ? 'all' : `${week1Share}%`} of it in week 1, before each habit had been taught once), on par with the whole-history prompt at ${usd(fh.misallocatedUsd)}, using **${Math.round(fh.tokensPerExpense / q.tokensPerExpense)}× fewer model tokens** and answering **${Math.round(fh.latencyMsMean / q.latencyMsMean)}× faster**, because the model only runs when someone corrects a split.`,
];
if (heldout) {
  lines.push(
    '',
    `**Fresh data.** The run above is the one that exposed a gap in the rule language (see the changelog in eval/README.md), so it is not a held-out test. On new bills (seed ${heldout.config.seed}) with the current code:`,
    '',
    table(heldout, ['equal', 'llm-full-history', 'quits']),
  );
}
const block = lines.join('\n');

const readme = readFileSync('README.md', 'utf8');
const start = '<!-- results:start -->';
const end = '<!-- results:end -->';
const a = readme.indexOf(start);
const b = readme.indexOf(end);
if (a < 0 || b < 0) throw new Error('README.md has no results markers');
writeFileSync('README.md', `${readme.slice(0, a + start.length)}\n${block}\n${readme.slice(b)}`);
console.log(`README results updated from ${main.runId}${heldout ? ` and ${heldout.runId}` : ''}`);
if (existsSync('README.md')) console.log(`headline: even split ${usd(eq.misallocatedUsd)} misallocated; quits ${q.firstTryExactPct}% vs full history ${fh.firstTryExactPct}%`);
