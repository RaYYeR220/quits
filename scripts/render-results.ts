// Prints the benchmark tables as markdown from a results file (eval/results/latest.json by default).
// Usage: pnpm eval:render [path/to/results.json]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { BenchResult } from '../eval/src/bench.ts';
import { renderMarkdown } from '../eval/src/report.ts';

const path = process.argv[2] ?? fileURLToPath(new URL('../eval/results/latest.json', import.meta.url));
const result = JSON.parse(await readFile(path, 'utf8')) as BenchResult;
process.stdout.write(renderMarkdown(result));
