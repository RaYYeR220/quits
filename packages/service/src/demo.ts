import { eq } from 'drizzle-orm';
import { encodeMemory, RuleSchema, type Category, type Tag } from '@quits/core';
import { corrections, groups, users } from '@quits/db';
import { nsGroupLog } from '@quits/memory';
import type { Ctx } from './context.ts';
import { accept, addExpense } from './expenses.ts';
import { addMember, createGroup, ensureUser } from './groups.ts';
import { learnRule } from './learned.ts';
import { enqueueMemory } from './memoryQueue.ts';

export const DEMO_MEMBERS = [
  { id: 'demo-ana', name: 'Ana', key: 'ANA' },
  { id: 'demo-ben', name: 'Ben', key: 'BEN' },
  { id: 'demo-clara', name: 'Clara', key: 'CLARA' },
  { id: 'demo-dan', name: 'Dan', key: 'DAN' },
] as const;
export const DEMO_FLAT = 'demo-flat-5b';
export const DEMO_TRIP = 'demo-lisbon';

type Step = {
  at: string;
  payer: string;
  text: string;
  category: Category;
  amount: string;
  items?: { label: string; amount: string; tags: Tag[] }[];
  participants?: string[];
  /** A correction the group made on this expense, and the rule it taught. */
  learn?: { by: string; said: string; sentence: string; scope: 'group' | 'member'; rule: Record<string, unknown> };
};

const A = 'demo-ana', B = 'demo-ben', C = 'demo-clara', D = 'demo-dan';

const FLAT: Step[] = [
  { at: '2026-10-13T18:20:00Z', payer: B, text: 'Biedronka groceries', category: 'groceries', amount: '186.40' },
  {
    at: '2026-10-14T20:10:00Z', payer: C, text: 'Dinner at Pod Baranami', category: 'dinner', amount: '412.00',
    items: [{ label: '2 bottles of wine', amount: '140.00', tags: ['alcohol'] }],
    learn: { by: A, said: 'I don’t drink, leave me out of the wine', sentence: 'Ana doesn’t drink, so leave her out of alcohol.', scope: 'member', rule: { kind: 'exclude', member: A, when: { tags: ['alcohol'] } } },
  },
  {
    at: '2026-10-15T09:00:00Z', payer: A, text: 'Rent October', category: 'rent', amount: '4800.00',
    learn: { by: A, said: 'rent goes by room size, I have the big room: 40, the rest 20 each', sentence: 'Rent splits by room size: Ana 40%, Ben, Clara and Dan 20% each.', scope: 'group', rule: { kind: 'weights', weights: { [A]: 40, [B]: 20, [C]: 20, [D]: 20 }, when: { category: ['rent'] } } },
  },
  {
    at: '2026-10-18T23:40:00Z', payer: D, text: 'Uber home from Kazimierz', category: 'taxi', amount: '38.00',
    learn: { by: B, said: 'I always cover taxis, put it on me', sentence: 'Ben always covers taxis.', scope: 'group', rule: { kind: 'covers', member: B, when: { category: ['taxi'] } } },
  },
  {
    at: '2026-10-21T19:30:00Z', payer: D, text: 'Steak night groceries', category: 'groceries', amount: '154.20',
    items: [{ label: 'steaks', amount: '96.00', tags: ['meat'] }],
    learn: { by: C, said: 'I’m vegetarian, no steak on my share', sentence: 'Clara is vegetarian, so no meat on her share.', scope: 'member', rule: { kind: 'exclude', member: C, when: { tags: ['meat'] } } },
  },
  {
    at: '2026-10-26T12:00:00Z', payer: C, text: 'Netflix', category: 'subscription', amount: '67.00',
    learn: { by: D, said: 'I’m not on the streaming account', sentence: 'Dan isn’t on the streaming account.', scope: 'group', rule: { kind: 'exclude', member: D, when: { category: ['subscription'] } } },
  },
  { at: '2026-10-28T18:05:00Z', payer: B, text: 'Biedronka groceries', category: 'groceries', amount: '212.80', items: [{ label: 'beer', amount: '24.00', tags: ['alcohol'] }] },
  { at: '2026-11-01T09:00:00Z', payer: A, text: 'Rent November', category: 'rent', amount: '4800.00' },
  { at: '2026-11-03T01:15:00Z', payer: C, text: 'Bolt from the airport', category: 'taxi', amount: '41.00' },
  {
    at: '2026-11-04T20:30:00Z', payer: B, text: 'Dinner at Pierogarnia', category: 'dinner', amount: '268.00',
    items: [
      { label: 'wine', amount: '72.00', tags: ['alcohol'] },
      { label: 'beef pierogi', amount: '44.00', tags: ['meat'] },
    ],
  },
  { at: '2026-11-05T10:00:00Z', payer: B, text: 'Spotify family', category: 'subscription', amount: '37.00' },
];

const TRIP: Step[] = [
  { at: '2026-11-02T20:45:00Z', payer: B, text: 'Time Out Market dinner', category: 'dinner', amount: '84.00', items: [{ label: 'wine', amount: '24.00', tags: ['alcohol'] }], participants: [A, B, C] },
  { at: '2026-11-03T09:10:00Z', payer: A, text: 'Sintra train, 3 tickets', category: 'activity', amount: '16.20', participants: [A, B, C] },
  { at: '2026-11-03T14:00:00Z', payer: C, text: 'Airbnb Alfama, 3 nights', category: 'accommodation', amount: '620.00', participants: [A, B, C] },
];

function minor(amount: string): bigint {
  const [w, f = ''] = amount.split('.');
  return BigInt(w ?? '0') * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
}

async function play(ctx: Ctx, groupId: string, currency: string, steps: Step[], members: string[]) {
  for (const s of steps) {
    let ruleId: string | null = null;
    if (s.learn) {
      const rule = RuleSchema.parse({ v: 1, id: ctx.id(), learnedAt: new Date(new Date(s.at).getTime() + 5 * 60_000).toISOString(), ...s.learn.rule });
      ruleId = rule.id;
      await learnRule(ctx, { rule, scope: s.learn.scope, sentence: s.learn.sentence, groupId, createdBy: s.learn.by });
    }
    const r = await addExpense(
      ctx,
      groupId,
      s.payer,
      {
        payerId: s.payer,
        currency,
        amountMinor: minor(s.amount),
        category: s.category,
        description: s.text,
        items: (s.items ?? []).map((i) => ({ label: i.label, amountMinor: minor(i.amount), tags: i.tags })),
        participants: s.participants ?? members,
        occurredAt: s.at,
      },
      { source: 'seed' },
    );
    if (!r.ok) throw new Error(`demo seed: could not add ${s.text}: ${JSON.stringify(r)}`);
    if (s.learn) {
      await ctx.db.insert(corrections).values({ id: ctx.id(), expenseId: r.proposal.draftId, userId: s.learn.by, text: s.learn.said, ruleId });
      await enqueueMemory(ctx, {
        ns: nsGroupLog(groupId),
        kind: 'event',
        text: encodeMemory(`Correction on ${s.text}: “${s.learn.said}”.`, { kind: 'event', event: 'correction', data: { expenseId: r.proposal.draftId, by: s.learn.by } }),
      });
    }
    await accept(ctx, r.proposal.draftId, s.payer);
  }
}

/**
 * Creates the demo groups ("Flat 5B" in Kraków, a Lisbon trip) with three weeks
 * of history. Rules are learned along the way exactly as corrections would teach
 * them; Ana's no-alcohol rule is portable and applies on the trip by itself.
 * Idempotent: does nothing if the demo flat already exists.
 */
export async function seedDemo(ctx: Ctx, addresses: Partial<Record<'ANA' | 'BEN' | 'CLARA' | 'DAN', string>> = {}): Promise<{ created: boolean }> {
  const [exists] = await ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, DEMO_FLAT)).limit(1);
  if (exists) return { created: false };
  for (const m of DEMO_MEMBERS) {
    await ensureUser(ctx, { id: m.id, name: m.name, authProvider: 'demo' });
    const addr = addresses[m.key];
    if (addr) await ctx.db.update(users).set({ suiAddress: addr }).where(eq(users.id, m.id));
  }
  const all = DEMO_MEMBERS.map((m) => m.id);
  await createGroup(ctx, { id: DEMO_FLAT, name: 'Flat 5B', defaultCurrency: 'PLN', ownerId: A, isDemo: true, createdAt: new Date('2026-10-12T10:00:00Z') });
  for (const m of [B, C, D]) await addMember(ctx, DEMO_FLAT, m, new Date('2026-10-12T10:00:00Z'));
  await play(ctx, DEMO_FLAT, 'PLN', FLAT, all);

  await createGroup(ctx, { id: DEMO_TRIP, name: 'Lisbon trip', defaultCurrency: 'EUR', ownerId: B, isDemo: true, createdAt: new Date('2026-11-01T08:00:00Z') });
  for (const m of [A, C]) await addMember(ctx, DEMO_TRIP, m, new Date('2026-11-01T08:00:00Z'));
  await play(ctx, DEMO_TRIP, 'EUR', TRIP, [A, B, C]);
  return { created: true };
}

/** Prefix of per-visitor sandbox tabs. */
export const SANDBOX_PREFIX = 'demo-tab-';

const SANDBOX: Step[] = [
  { at: '', payer: B, text: 'Morning coffees', category: 'drinks', amount: '7.20' },
  { at: '', payer: C, text: 'Friday beers and fries', category: 'drinks', amount: '9.60', items: [{ label: 'beers', amount: '6.40', tags: ['alcohol'] }] },
];

/**
 * A small, fresh tab for one demo visitor: the four flatmates, two small
 * expenses, debts of a few USDC that can be settled for real on mainnet.
 * The members' portable rules (Ana's, Clara's) apply here by themselves.
 */
export async function createSandbox(ctx: Ctx, key: string): Promise<string> {
  const id = `${SANDBOX_PREFIX}${key}`;
  const [exists] = await ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).limit(1);
  if (exists) return id;
  await createGroup(ctx, { id, name: 'Coffee tab', defaultCurrency: 'USD', ownerId: A, isDemo: true });
  for (const m of [B, C, D]) await addMember(ctx, id, m);
  const now = ctx.now().getTime();
  await play(ctx, id, 'USD', SANDBOX.map((s, i) => ({ ...s, at: new Date(now - (2 - i) * 3_600_000).toISOString() })), [A, B, C, D]);
  return id;
}
