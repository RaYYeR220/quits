import { describe, expect, it } from 'vitest';
import { parseUsdc as u, split, sumMicro, type Expense } from '@quits/core';
import { generate, toExpense } from '../src/expenses.ts';
import { GROUP_IDS, GROUPS, SAY_EVEN, hiddenRules, type GroupId } from '../src/groups.ts';
import { evenSplit, nextCorrection, rulesAt, truth } from '../src/member.ts';

const SEED = 20261106;
const streams = Object.fromEntries(GROUP_IDS.map((g) => [g, generate(g, { weeks: 4, perWeek: 10, seed: SEED })])) as Record<GroupId, ReturnType<typeof generate>>;

function expense(groupId: GroupId, o: Partial<Expense> & Pick<Expense, 'category' | 'payerId' | 'usdcMicro'>): Expense {
  return {
    id: 'x',
    groupId,
    currency: 'USD',
    amountMinor: o.usdcMicro / 10_000n,
    items: [],
    participants: GROUPS[groupId].members.map((m) => m.id),
    description: 'x',
    occurredAt: '2026-10-05T12:00:00.000Z',
    ...o,
  };
}

describe('ground truth', () => {
  it('ground_truth_matches_engine', () => {
    for (const g of GROUP_IDS) {
      for (const x of streams[g]) {
        const e = toExpense(x);
        const t = truth(e, GROUPS[g]);
        expect(t).toEqual(split(e, hiddenRules(GROUPS[g])).shares);
        expect(sumMicro(Object.values(t))).toBe(e.usdcMicro);
        expect(Object.keys(t).sort()).toEqual([...new Set(x.participants)].sort());
      }
    }

    // the hidden rules mean what the README says they mean
    const flat = GROUPS.flat;
    expect(truth(expense('flat', { category: 'rent', payerId: 'ana', usdcMicro: u('1040') }), flat)).toEqual({ ana: u('416'), ben: u('208'), clara: u('208'), dan: u('208') });
    const dinner = truth(expense('flat', { category: 'dinner', payerId: 'ben', usdcMicro: u('120'), items: [{ label: 'wine', usdcMicro: u('40'), tags: ['alcohol'] }] }), flat);
    expect(dinner.ana).toBe(u('20'));
    expect(truth(expense('flat', { category: 'taxi', payerId: 'dan', usdcMicro: u('30') }), flat)).toEqual({ ana: 0n, ben: u('30'), clara: 0n, dan: 0n });
    expect(truth(expense('flat', { category: 'subscription', payerId: 'ben', usdcMicro: u('21') }), flat)).toEqual({ ana: u('7'), ben: u('7'), clara: u('7'), dan: 0n });

    const trip = GROUPS.trip;
    const ski = truth(expense('trip', { category: 'activity', payerId: 'eve', usdcMicro: u('230'), items: [{ label: 'Lift passes', usdcMicro: u('180'), tags: ['ski'] }] }), trip);
    expect(ski).toEqual({ ana: u('10'), ben: u('70'), clara: u('10'), dan: u('70'), eve: u('70') });
    const fuel = truth(expense('trip', { category: 'fuel', payerId: 'ana', usdcMicro: u('90'), items: [{ label: 'Petrol', usdcMicro: u('90'), tags: ['fuel'] }] }), trip);
    expect(fuel).toEqual({ ana: u('30'), ben: u('30'), clara: u('30'), dan: 0n, eve: 0n });
    expect(truth(expense('trip', { category: 'accommodation', payerId: 'ben', usdcMicro: u('600') }), trip).ana).toBe(u('200'));

    const couple = GROUPS.couple;
    expect(truth(expense('couple', { category: 'groceries', payerId: 'gia', usdcMicro: u('100') }), couple)).toEqual({ fin: u('60'), gia: u('40') });
    const finStuff = truth(expense('couple', { category: 'other', payerId: 'fin', usdcMicro: u('80'), items: [{ label: 'socks', usdcMicro: u('30'), tags: ['personal'] }] }), couple);
    expect(finStuff).toEqual({ fin: u('60'), gia: u('20') });
    const giaStuff = truth(expense('couple', { category: 'other', payerId: 'gia', usdcMicro: u('50'), items: [{ label: 'novel', usdcMicro: u('20'), tags: ['personal'] }] }), couple);
    expect(giaStuff).toEqual({ fin: u('18'), gia: u('32') });
  });

  it('every_hidden_rule_is_triggered', () => {
    for (const g of GROUP_IDS) {
      const seen = new Map<string, number>();
      let none = 0;
      for (const x of streams[g]) {
        const rs = rulesAt(toExpense(x), GROUPS[g]);
        if (rs.length === 0) none += 1;
        for (const r of rs) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
      }
      for (const h of GROUPS[g].hidden) expect(seen.get(h.rule.id) ?? 0, h.rule.id).toBeGreaterThanOrEqual(3);
      // the couple splits everything 60/40, so only the other groups have rule-free expenses
      if (g !== 'couple') expect(none, g).toBeGreaterThanOrEqual(3);
    }
  });

  it('member corrections only name rules in play and never quote amounts', () => {
    for (const g of GROUP_IDS) {
      for (const h of GROUPS[g].hidden) {
        expect(h.say.length).toBeGreaterThanOrEqual(3);
        for (const s of h.say) expect(s).not.toMatch(/\$|\d+\.\d{2}/);
      }
      for (const x of streams[g]) {
        const e = toExpense(x);
        const inPlay = rulesAt(e, GROUPS[g]).map((r) => r.id);
        const pick = nextCorrection(e, GROUPS[g], evenSplit(e), [], { seed: SEED, n: x.n });
        if (inPlay.length === 0) {
          expect(pick.ruleId).toBe('even');
          expect(SAY_EVEN).toContain(pick.text);
        } else {
          expect(inPlay).toContain(pick.ruleId);
          expect(GROUPS[g].hidden.find((h) => h.rule.id === pick.ruleId)?.say).toContain(pick.text);
        }
      }
    }
  });

  it('a correction already reflected is not raised again', () => {
    // Dinner with wine and steak: once Ana is left out of the wine, the member talks about Clara and the meat
    const e = expense('flat', {
      category: 'dinner',
      payerId: 'ben',
      usdcMicro: u('160'),
      items: [
        { label: 'wine', usdcMicro: u('40'), tags: ['alcohol'] },
        { label: 'steak', usdcMicro: u('40'), tags: ['meat'] },
      ],
    });
    const anaOnly = split(e, hiddenRules(GROUPS.flat).filter((r) => r.id === 'flat.ana-no-alcohol')).shares;
    expect(nextCorrection(e, GROUPS.flat, anaOnly, [], { seed: SEED, n: 0 }).ruleId).toBe('flat.clara-no-meat');
  });

  it('is the same stream for the same seed and a different one for another', () => {
    expect(generate('trip', { weeks: 4, perWeek: 10, seed: SEED })).toEqual(streams.trip);
    expect(generate('trip', { weeks: 4, perWeek: 10, seed: SEED + 1 })).not.toEqual(streams.trip);
  });
});
