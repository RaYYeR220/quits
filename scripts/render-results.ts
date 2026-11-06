// Prints the benchmark tables as markdown from results files (eval/results/latest.json by default).
// With several files, each system's numbers come from the last file that has it:
//   pnpm eval:render eval/results/<baselines>.json eval/results/<quits-v2>.json
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BenchResult } from '../eval/src/bench.ts';
import { mergeRuns, renderMarkdown } from '../eval/src/report.ts';

const paths = process.argv.slice(2);
if (paths.length === 0) paths.push(fileURLToPath(new URL('../eval/results/latest.json', import.meta.url)));
const runs = await Promise.all(paths.map(async (p) => JSON.parse(await readFile(p, 'utf8')) as BenchResult));
process.stdout.write(renderMarkdown(mergeRuns(runs)));
