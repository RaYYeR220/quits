import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allocate } from '@quits/core';
import { runBench, writeResults, type BenchOptions, type BenchResult } from '../src/bench.ts';
import { generate } from '../src/expenses.ts';
import { GROUP_IDS, GROUPS } from '../src/groups.ts';
import { fakeLlm } from '../src/fakeLlm.ts';
import { distance } from '../src/member.ts';
import { mergeRuns, renderMarkdown } from '../src/report.ts';
import { equal } from '../src/systems/equal.ts';
import { SYSTEMS } from '../src/systems/index.ts';

const base = (o: Partial<BenchOptions>): BenchOptions => ({
  systems: [...SYSTEMS],
  groups: [...GROUP_IDS],
  weeks: 2,
  perWeek: 10,
  seed: 20261106,
  llm: fakeLlm(),
  model: 'fake',
  provider: 'fake',
  concurrency: 4,
  ...o,
});

describe('systems', () => {
  it('equal_system_is_the_equal_split', async () => {
    for (const g of GROUP_IDS) {
      const s = await equal.start(GROUPS[g], fakeLlm());
      for (const x of generate(g, { weeks: 4, perWeek: 10, seed: 7 })) {
        const p = await s.propose(x);
        const even = allocate(BigInt(x.cents) * 10_000n, Object.fromEntries(x.participants.map((m) => [m, 1])));
        expect(p).toEqual({ shares: even });
        expect((await s.correct('Ana doesn’t drink, leave her out of the alcohol.', x.payerId)).proposal).toEqual(p);
        await s.settle(even, false);
      }
    }
  });

  it('memory_off_equals_equal', async () => {
    const r = await runBench(base({ systems: ['equal', 'quits-memory-off'] }));
    const byKey = new Map(r.records.filter((x) => x.system === 'equal').map((x) => [x.expenseId, x]));
    const off = r.records.filter((x) => x.system === 'quits-memory-off');
    expect(off).toHaveLength(60);
    for (const rec of off) {
      const eq = byKey.get(rec.expenseId);
      const shares = (j: Record<string, string> | null) => Object.fromEntries(Object.entries(j ?? {}).map(([m, v]) => [m, BigInt(v.replace('.', ''))]));
      // the service splits line by line, so rounding may differ by a few micro-USDC
      expect(distance(shares(rec.first.shares), shares(eq?.first.shares ?? null))).toBeLessThanOrEqual(10n);
      expect(rec.first.exact).toBe(eq?.first.exact);
    }
    expect(r.aggregates['quits-memory-off']?.total.firstTryExact).toBe(r.aggregates.equal?.total.firstTryExact);
    expect(r.aggregates['quits-memory-off']?.total.misallocatedUsd).toBe(r.aggregates.equal?.total.misallocatedUsd);
  }, 120_000);

  it('fake_llm_run_completes_and_writes_results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'quits-eval-'));
    try {
      const r = await runBench(base({}));
      const files = await writeResults(r, dir, { latest: true });
      expect(files).toEqual([join(dir, `${r.runId}.json`), join(dir, 'latest.json')]);
      const back = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')) as BenchResult;

      expect(back.config).toMatchObject({ seed: 20261106, model: 'fake', weeks: 2, maxCorrections: 2, toleranceUsd: '0.01' });
      expect(back.records).toHaveLength(SYSTEMS.length * GROUP_IDS.length * 20);
      for (const s of SYSTEMS) {
        expect(back.aggregates[s]?.byWeek).toHaveLength(2);
        expect(back.aggregates[s]?.total.expenses).toBe(60);
      }
      for (const rec of back.records) {
        expect(rec.corrections.length).toBeLessThanOrEqual(2);
        expect(rec.unresolved).toBe(!rec.finalExact);
        if (rec.first.exact) expect(rec.corrections).toEqual([]);
      }

      // with corrections compiled perfectly, the engine ends up exactly where the hidden rules are
      const quits = back.aggregates.quits!;
      expect(quits.byWeek[1]!.firstTryExactPct).toBeGreaterThan(back.aggregates.equal!.byWeek[1]!.firstTryExactPct);
      expect(back.aggregates['llm-full-history']!.total.promptTokensPerExpense).toBeGreaterThan(back.aggregates['llm-no-memory']!.total.promptTokensPerExpense);
      expect(back.aggregates.equal!.total.llmCalls).toBe(0);

      const md = renderMarkdown(back);
      expect(md).toContain('not a result');
      expect(md).toContain('First-try exact, by week');
      for (const s of SYSTEMS) expect(md).toContain(`\`${s}\``);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('trip_after_flat_carries_portable_rules', async () => {
    const r = await runBench(base({ systems: ['quits'], groups: ['trip'], scenarios: ['trip-after-flat'] }));
    const warm = r.records.filter((x) => x.scenario === 'trip-after-flat');
    expect(warm.filter((x) => x.group === 'flat')).toHaveLength(20);
    expect(warm.filter((x) => x.group === 'trip')).toHaveLength(20);
    // the flat runs first and ends before the trip starts
    const lastFlat = warm.filter((x) => x.group === 'flat').at(-1)!;
    expect(lastFlat.expenseId).toMatch(/^flat-/);
    expect(r.aggregates.quits?.total.expenses).toBe(20);

    // Ana's and Clara's rules from the flat are never taught again on the trip
    const taughtOnTrip = warm.filter((x) => x.group === 'trip').flatMap((x) => x.corrections.map((c) => c.ruleId));
    expect(taughtOnTrip).not.toContain('trip.ana-no-alcohol');
    expect(taughtOnTrip).not.toContain('trip.clara-no-meat');
    const cold = r.records.filter((x) => !x.scenario).flatMap((x) => x.corrections.map((c) => c.ruleId));
    expect(cold).toContain('trip.ana-no-alcohol');

    const sc = r.scenarios?.['trip-after-flat'];
    expect(sc?.byGroup.trip?.total.firstTryExact).toBeGreaterThan(r.aggregates.quits!.byGroup.trip!.total.firstTryExact);
    expect(renderMarkdown(r)).toContain('Same people, second group');
  }, 180_000);

  it('render_merges_runs_latest_per_system', async () => {
    const v1 = await runBench(base({ systems: ['equal', 'quits'], weeks: 1 }));
    const v2 = { ...(await runBench(base({ systems: ['quits'], weeks: 1, label: 'v2' }))), runId: 'later-v2' };
    const merged = mergeRuns([v1, v2]);
    expect(merged.config.systems).toEqual(['equal', 'quits']);
    expect(merged.sources).toEqual([
      { what: 'equal', runId: v1.runId },
      { what: 'quits', runId: 'later-v2', label: 'v2' },
    ]);
    expect(merged.aggregates.quits).toEqual(v2.aggregates.quits);
    expect(merged.records.filter((x) => x.system === 'quits')).toEqual(v2.records);
    expect(renderMarkdown(merged)).toContain('v2 `later-v2` for `quits`');
    expect(() => mergeRuns([v1, { ...v2, config: { ...v2.config, seed: 1 } }])).toThrow(/not comparable/);
  }, 180_000);
});
