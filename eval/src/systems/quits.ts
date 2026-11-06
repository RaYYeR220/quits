import { memoryDb } from '@quits/db';
import type { Llm } from '@quits/llm';
import { createMockStore } from '@quits/memory';
import { createQuits, type FxPort, type Quits } from '@quits/service';
import { toDraft, type EvalExpense } from '../expenses.ts';
import type { GroupDef } from '../groups.ts';
import type { CorrectionNote, Proposal, Session, System } from './types.ts';

// Every benchmark expense is in USD, which the service prices 1:1 without a lookup.
const noFx: FxPort = {
  async usdcPerFiat(code) {
    throw new Error(`the benchmark has no FX for ${code}`);
  },
};

/** One Quits deployment: database, memory store and clock. Groups opened in it share its people. */
export interface QuitsWorld {
  q: Quits;
  setNow(d: Date): void;
  now(): Date;
}

export async function quitsWorld(llm: Llm, memoryEnabled: boolean): Promise<QuitsWorld> {
  let now = new Date(0);
  let seq = 0;
  const q = createQuits({
    db: await memoryDb(),
    memory: createMockStore(),
    llm,
    fx: noFx,
    clock: () => now,
    ids: () => `q${String((seq += 1)).padStart(6, '0')}`,
    memoryEnabled,
  });
  return { q, setNow: (d) => (now = d), now: () => now };
}

/** Opens the group in this deployment (people are reused by id) and reviews its expenses through the service. */
export async function quitsSession(w: QuitsWorld, g: GroupDef): Promise<Session> {
  const { q } = w;
  for (const m of g.members) await q.ensureUser({ id: m.id, name: m.name, authProvider: 'demo' });
  const owner = g.members[0];
  if (!owner) throw new Error(`${g.id} has no members`);
  await q.createGroup({ id: g.id, name: g.name, defaultCurrency: 'USD', ownerId: owner.id });
  for (const m of g.members.slice(1)) await q.addMember(g.id, m.id);

  let draft: { id: string; payer: string } | null = null;
  let last: Proposal = { invalid: 'nothing proposed yet' };

  return {
    async propose(x: EvalExpense) {
      w.setNow(new Date(x.occurredAt));
      const r = await q.addExpense(g.id, x.payerId, toDraft(x), { source: 'eval' });
      if (!r.ok) throw new Error(`addExpense refused ${x.id}: ${JSON.stringify(r)}`);
      draft = { id: r.proposal.draftId, payer: x.payerId };
      last = { shares: r.proposal.shares };
      return last;
    },
    async correct(text, by) {
      if (!draft) throw new Error('no draft in progress');
      w.setNow(new Date(w.now().getTime() + 60_000));
      let note: CorrectionNote;
      try {
        const c = await q.correct(draft.id, by, text);
        if (c.ok) {
          last = { shares: c.proposal.shares };
          const learned = c.learned;
          if (learned) {
            const listed = (await q.rules(g.id)).find((r) => r.id === learned.ruleId);
            note = { learned: { sentence: learned.sentence, rule: listed?.rule ?? null } };
          } else {
            note = { fixed: c.fixed ?? { absent: [] } };
          }
        } else {
          note = { clarify: c.clarify };
        }
      } catch (e) {
        note = { error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
      }
      return { proposal: last, note };
    },
    // The service has no manual-share override yet, so a hand-fixed expense is
    // posted as proposed. Posted shares never turn into rules, so this can't
    // help or hurt later proposals.
    async settle() {
      if (!draft) return;
      await q.accept(draft.id, draft.payer);
      await q.flushMemory();
      draft = null;
    },
  };
}

/**
 * The real service on an in-process Postgres and the in-memory Walrus Memory
 * stand-in: structured draft in, corrections through `correct`, memory flushed
 * between expenses. Each group gets a fresh deployment. With `memoryEnabled: false`
 * it is the ablation.
 */
function quitsSystem(name: 'quits' | 'quits-memory-off', memoryEnabled: boolean): System {
  return {
    name,
    usesLlm: true,
    start: async (g, llm) => quitsSession(await quitsWorld(llm, memoryEnabled), g),
  };
}

export const quits = quitsSystem('quits', true);
export const quitsMemoryOff = quitsSystem('quits-memory-off', false);
