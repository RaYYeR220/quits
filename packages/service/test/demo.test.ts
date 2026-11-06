import { describe, expect, it } from 'vitest';
import { memoryDb } from '@quits/db';
import { createMockStore } from '@quits/memory';
import { createQuits, DEMO_FLAT, DEMO_TRIP } from '../src/index.ts';
import { fx, scriptedLlm } from './helpers.ts';

describe('demo seed', () => {
  it('builds both groups with learned rules and stays idempotent', async () => {
    let n = 0;
    const q = createQuits({ db: await memoryDb(), memory: createMockStore(), llm: scriptedLlm().llm, fx, ids: () => `s${(n += 1)}` });
    expect(await q.seedDemo({ ANA: '0xa' })).toEqual({ created: true });
    expect(await q.seedDemo()).toEqual({ created: false });
    await q.flushMemory();

    const flat = await q.expenses(DEMO_FLAT);
    expect(flat).toHaveLength(11);
    const rules = await q.rules(DEMO_FLAT);
    expect(rules.filter((r) => r.status === 'active')).toHaveLength(5);
    expect(rules.every((r) => r.memoryState === 'done' && r.blobId)).toBe(true);

    // Ana's portable rule follows her to Lisbon: she pays nothing for the wine there.
    const trip = await q.expenses(DEMO_TRIP);
    const dinner = trip.find((e) => e.expense.description === 'Time Out Market dinner');
    const wine = dinner!.expense.items[0]!.usdcMicro;
    const food = dinner!.expense.usdcMicro - wine;
    expect(dinner!.shares['demo-ana']).toBe(food / 3n + (food % 3n > 0n ? 1n : 0n));
    expect(Object.values(dinner!.shares).reduce((a, b) => a + b, 0n)).toBe(dinner!.expense.usdcMicro);

    const debts = await q.refreshDebts(DEMO_FLAT);
    expect(debts.length).toBeGreaterThan(0);
  });
});

describe('sandbox tab', () => {
  it('gives each visitor small payable debts with portable rules applied', async () => {
    let n = 0;
    const q = createQuits({ db: await memoryDb(), memory: createMockStore(), llm: scriptedLlm().llm, fx, ids: () => `x${(n += 1)}` });
    await q.seedDemo();
    await q.flushMemory();
    const id = await q.createSandbox('abc');
    expect(await q.createSandbox('abc')).toBe(id);
    const ex = await q.expenses(id);
    const beers = ex.find((e) => e.expense.description === 'Friday beers and crisps')!;
    // Ana doesn't drink: 0.60 of beers split by Ben, Clara, Dan; crisps 0.40 split by four
    expect(beers.shares['demo-ana']).toBe(100_000n);
    const debts = await q.refreshDebts(id);
    expect(debts.every((d) => d.usdcMicro <= 500_000n)).toBe(true);
  });
});
