import { memoryDb } from '@quits/db';
import type { Llm } from '@quits/llm';
import { createMockStore, type MemoryStore } from '@quits/memory';
import { createQuits, type FxPort } from '../src/index.ts';

/** LLM double: answers each prompt with the next queued JSON object. */
export function scriptedLlm() {
  const queue: unknown[] = [];
  const llm: Llm = {
    async raw() {
      if (queue.length === 0) throw new Error('scriptedLlm: nothing queued');
      return { content: JSON.stringify(queue.shift()), usage: { prompt: 0, completion: 0 } };
    },
  };
  return { llm, push: (...o: unknown[]) => queue.push(...o) };
}

export const fx: FxPort = {
  async usdcPerFiat(code) {
    const rates: Record<string, string> = { EUR: '1.25', PLN: '0.25' };
    const rate = rates[code];
    if (!rate) throw new Error(`no rate for ${code}`);
    return { rate, source: 'tatum', at: '2026-11-06T10:00:00Z' };
  },
};

let tick = 0;
export function clockAt(iso: string) {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    set: (s: string) => {
      t = new Date(s).getTime();
    },
  };
}

export async function setup(opts: { memory?: MemoryStore; memoryEnabled?: boolean; at?: string } = {}) {
  const db = await memoryDb();
  const memory = opts.memory ?? createMockStore();
  const s = scriptedLlm();
  const clock = clockAt(opts.at ?? '2026-10-12T19:00:00Z');
  const q = createQuits({
    db,
    memory,
    llm: s.llm,
    fx,
    clock: clock.now,
    ids: () => `id${(tick += 1).toString().padStart(5, '0')}`,
    memoryEnabled: opts.memoryEnabled ?? true,
  });
  for (const [id, name] of [
    ['ana', 'Ana'],
    ['ben', 'Ben'],
    ['clara', 'Clara'],
    ['dan', 'Dan'],
  ] as const) {
    await q.ensureUser({ id, name, authProvider: 'demo' });
  }
  const groupId = await q.createGroup({ id: 'flat', name: 'Flat 5B', defaultCurrency: 'EUR', ownerId: 'clara' });
  for (const m of ['ana', 'ben', 'dan']) await q.addMember(groupId, m);
  return { q, db, memory, llm: s, clock, groupId };
}

/** What the parser would return for "84 € dinner, I paid, 24 of it was wine". */
export const dinnerParse = {
  status: 'ok',
  missing: [],
  payer: 'clara',
  amount: '84.00',
  currency: 'EUR',
  category: 'dinner',
  description: 'Dinner at Time Out Market',
  items: [{ label: 'wine', amount: '24.00', tags: ['alcohol'] }],
  participants: ['ana', 'ben', 'clara', 'dan'],
  occurredOn: null,
};

export const anaNoAlcohol = {
  status: 'rule',
  scope: 'member',
  sentence: 'Ana doesn’t drink, so leave her out of alcohol.',
  rule: { kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } },
};
