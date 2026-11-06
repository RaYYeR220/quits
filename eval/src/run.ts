// Split-learning benchmark.
// pnpm eval [--systems=equal,quits,...] [--groups=flat,trip,couple] [--weeks=4] [--per-week=10] [--seed=20261106]
//           [--scenarios=trip-after-flat] [--model=mercury-3] [--concurrency=4] [--label=v2] [--out=dir] [--no-latest]
// LLM_API_KEY (+ LLM_BASE_URL, LLM_MODEL) for a real model, or EVAL_LLM=fake for an offline run.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBench, SCENARIOS, writeResults, type ScenarioName } from './bench.ts';
import { GROUP_IDS, type GroupId } from './groups.ts';
import { llmFromEnv } from './llm.ts';
import { renderMarkdown } from './report.ts';
import { SYSTEMS, type SystemName } from './systems/index.ts';

export const DEFAULT_SEED = 20261106;

function flags(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unknown argument ${a}`);
    out.set(m[1] ?? '', m[2] ?? 'true');
  }
  return out;
}

function list<T extends string>(raw: string | undefined, all: readonly T[], what: string): T[] {
  if (!raw) return [...all];
  const xs = raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const x of xs) if (!all.includes(x as T)) throw new Error(`unknown ${what} "${x}" (known: ${all.join(', ')})`);
  return xs as T[];
}

function int(raw: string | undefined, fallback: number, what: string): number {
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0) throw new Error(`--${what} must be a whole number`);
  return v;
}

const f = flags(process.argv.slice(2));
const known = new Set(['systems', 'groups', 'scenarios', 'weeks', 'per-week', 'seed', 'model', 'concurrency', 'out', 'label', 'no-latest']);
for (const k of f.keys()) if (!known.has(k)) throw new Error(`unknown flag --${k}`);

const systems = list<SystemName>(f.get('systems'), SYSTEMS, 'system');
const groups = list<GroupId>(f.get('groups'), GROUP_IDS, 'group');
const scenarios = f.get('scenarios') ? list<ScenarioName>(f.get('scenarios'), SCENARIOS, 'scenario') : [];
const label = f.get('label');
if (label !== undefined && !/^[a-z0-9-]+$/i.test(label)) throw new Error('--label may only use letters, digits and dashes');
const concurrency = Math.max(1, int(f.get('concurrency'), 4, 'concurrency'));
const log = (s: string) => console.error(s);
const { llm, model, provider } = llmFromEnv(process.env, { model: f.get('model'), concurrency, log });
const fake = model === 'fake';
const out = f.get('out') ?? fileURLToPath(new URL(fake ? '../results/fake' : '../results', import.meta.url));

/** The code about to be measured. Read before the run, since the tree may change while it goes. */
function codeState(): { commit: string; dirty: string[] } | undefined {
  try {
    // trimEnd: porcelain lines start with a status column that may be a space
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
    const dirty = git('status', '--porcelain', '--', 'packages', 'apps', 'eval/src').split('\n').filter(Boolean).map((l) => l.slice(3));
    return { commit: git('rev-parse', '--short', 'HEAD'), dirty };
  } catch {
    return undefined; // not a git checkout
  }
}

log(`benchmark: ${systems.join(', ')} on ${groups.join(', ')}${scenarios.length ? ` + ${scenarios.join(', ')}` : ''} with ${model}`);
const code = codeState();
const result = await runBench({
  systems,
  groups,
  scenarios,
  weeks: int(f.get('weeks'), 4, 'weeks'),
  perWeek: int(f.get('per-week'), 10, 'per-week'),
  seed: int(f.get('seed'), DEFAULT_SEED, 'seed'),
  llm,
  model,
  provider,
  concurrency,
  ...(label ? { label } : {}),
  ...(code ? { code } : {}),
  log,
});
const files = await writeResults(result, out, { latest: !f.has('no-latest') });
console.log(renderMarkdown(result));
log(`wrote ${files.join(', ')}`);
