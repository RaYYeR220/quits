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

// The held-out run is the headline: its bills were generated from a seed the rule language was never tuned on.
const head = heldout ?? main;
const eq = head.aggregates.equal!.total;
const q = head.aggregates.quits!.total;
const fh = head.aggregates['llm-full-history']!.total;
const pct = (n: number) => `${n.toFixed(1)}%`;
const cmp = (a: number, b: number) => (Math.abs(a - b) < 0.05 ? 'as often as' : a > b ? 'more often than' : 'a little less often than');
const fewer = Number(fh.correctionsPer10) < Number(q.correctionsPer10);
const lines = [
  `Three simulated groups (a flat of four, a trip of five, a couple), four weeks, 40 bills each, ${head.config.model}. A simulated member corrects a wrong split in plain words, up to twice per bill. "Right" means every share within $0.01.${heldout ? ` These bills come from seed ${heldout.config.seed}, generated after the rule language was frozen.` : ''} Method and caveats: [eval/README.md](eval/README.md).`,
  '',
  table(head, heldout ? ['equal', 'llm-full-history', 'quits'] : order),
  '',
  weeks(head, ['llm-full-history', 'quits']),
  '',
  `Even splits put **${usd(eq.misallocatedUsd)}** in the wrong pocket over the month. Quits is right the first time ${cmp(q.firstTryExactPct, fh.firstTryExactPct)} an LLM that re-reads the whole group history (${pct(q.firstTryExactPct)} vs ${pct(fh.firstTryExactPct)}), with **${Math.round(fh.tokensPerExpense / q.tokensPerExpense)}× fewer model tokens** and **${Math.round(fh.latencyMsMean / q.latencyMsMean)}× faster**, because the model only runs when someone corrects a split, and every answer names the rule and the memory behind it.` +
    (fewer
      ? ` The whole-history prompt needs slightly fewer corrections (${fh.correctionsPer10.toFixed(2)} vs ${q.correctionsPer10.toFixed(2)} per 10 bills) and leaves ${usd(fh.misallocatedUsd)} misallocated to Quits' ${usd(q.misallocatedUsd)}: re-reading every bill catches a few habits Quits' rule language can't express yet.`
      : ''),
];
if (heldout) {
  lines.push(
    '',
    `**Development run** (seed ${main.config.seed}). This is the run that exposed a missing rule kind (see the changelog in eval/README.md), so it is not a held-out test. It adds two controls: the same LLM with no history, and Quits with memory switched off.`,
    '',
    table(main, order),
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
