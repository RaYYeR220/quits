import { describe, expect, it } from 'vitest';
import type { Expense, Item } from '../src/types.ts';
import { RuleSchema, ruleKey, supersede, type Rule } from '../src/rules.ts';
import { split } from '../src/split.ts';
import { parseUsdc as u, sumMicro } from '../src/money.ts';

const FLAT = ['ana', 'ben', 'clara', 'dan'];

function expense(over: Partial<Expense> & { usdc: string; items?: Item[] }): Expense {
  const { usdc, ...rest } = over;
  return {
    id: 'e1',
    groupId: 'g1',
    payerId: 'clara',
    usdcMicro: u(usdc),
    currency: 'USD',
    amountMinor: 0n,
    category: 'dinner',
    items: [],
    participants: FLAT,
    description: 'test',
    occurredAt: '2026-11-01T19:00:00Z',
    ...rest,
  };
}

let n = 0;
function rule(r: Record<string, unknown>): Rule {
  n += 1;
  return RuleSchema.parse({ v: 1, id: `r${n}`, learnedAt: `2026-10-${String(10 + n).padStart(2, '0')}T12:00:00Z`, when: {}, ...r });
}

function total(shares: Record<string, bigint>) {
  return sumMicro(Object.values(shares));
}

describe('split', () => {
  it('splits equally without rules', () => {
    const r = split(expense({ usdc: '84.00' }), []);
    expect(r.shares).toEqual({ ana: u('21'), ben: u('21'), clara: u('21'), dan: u('21') });
    expect(r.applied).toEqual([]);
  });

  it('leaves a member out of an alcohol item only', () => {
    const e = expense({ usdc: '84.00', items: [{ label: 'wine', usdcMicro: u('24.00'), tags: ['alcohol'] }] });
    const r = split(e, [rule({ kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } })]);
    // 60.00 food split four ways = 15.00 each; 24.00 wine split three ways = 8.00 each
    expect(r.shares).toEqual({ ana: u('15'), ben: u('23'), clara: u('23'), dan: u('23') });
    expect(r.applied).toEqual([{ ruleId: expect.any(String), target: 0 }]);
    expect(total(r.shares)).toBe(e.usdcMicro);
  });

  it('splits rent by weights', () => {
    const e = expense({ usdc: '1000.00', category: 'rent' });
    const r = split(e, [rule({ kind: 'weights', weights: { ana: 40, ben: 20, clara: 20, dan: 20 }, when: { category: ['rent'] } })]);
    expect(r.shares).toEqual({ ana: u('400'), ben: u('200'), clara: u('200'), dan: u('200') });
  });

  it('puts the whole taxi on the member who covers taxis', () => {
    const e = expense({ usdc: '9.50', category: 'taxi', payerId: 'dan' });
    const r = split(e, [rule({ kind: 'covers', member: 'ben', when: { category: ['taxi'] } })]);
    expect(r.shares).toEqual({ ana: 0n, ben: u('9.50'), clara: 0n, dan: 0n });
  });

  it('keeps the payer out when the rule says so', () => {
    const e = expense({ usdc: '30.00', category: 'groceries', payerId: 'ben' });
    const r = split(e, [rule({ kind: 'payerExcluded', when: { category: ['groceries'] } })]);
    expect(r.shares).toEqual({ ana: u('10'), ben: 0n, clara: u('10'), dan: u('10') });
  });

  it('shares an item only among the named members', () => {
    const e = expense({ usdc: '100.00', category: 'activity', items: [{ label: 'ski pass', usdcMicro: u('80.00'), tags: ['ski'] }] });
    const r = split(e, [rule({ kind: 'only', members: ['ana', 'ben'], when: { tags: ['ski'] } })]);
    expect(r.shares).toEqual({ ana: u('45'), ben: u('45'), clara: u('5'), dan: u('5') });
  });

  it('puts personal items on whoever bought them, with the rest by weights', () => {
    const rules = [
      rule({ kind: 'weights', weights: { fin: 60, gia: 40 }, when: {} }),
      rule({ kind: 'payerCovers', when: { tags: ['personal'] } }),
    ];
    const base = { participants: ['fin', 'gia'], category: 'groceries' as const, items: [{ label: 'razor', usdcMicro: u('10'), tags: ['personal' as const] }] };
    expect(split(expense({ usdc: '60.00', payerId: 'gia', ...base }), rules).shares).toEqual({ fin: u('30'), gia: u('30') });
    expect(split(expense({ usdc: '60.00', payerId: 'fin', ...base }), rules).shares).toEqual({ fin: u('40'), gia: u('20') });
  });

  it('lets covers win over exclude', () => {
    const e = expense({ usdc: '20.00', category: 'taxi' });
    const r = split(e, [
      rule({ kind: 'exclude', member: 'ben', when: { category: ['taxi'] } }),
      rule({ kind: 'covers', member: 'ben', when: { category: ['taxi'] } }),
    ]);
    expect(r.shares.ben).toBe(u('20'));
  });

  it('applies the newer of two rules with the same key', () => {
    const older = rule({ kind: 'weights', weights: { ana: 40, ben: 20, clara: 20, dan: 20 }, when: { category: ['rent'] } });
    const newer = rule({ kind: 'weights', weights: { ana: 25, ben: 25, clara: 25, dan: 25 }, when: { category: ['rent'] } });
    const r = split(expense({ usdc: '1000.00', category: 'rent' }), [newer, older]);
    expect(r.shares.ana).toBe(u('250'));
    expect(r.applied.map((a) => a.ruleId)).toEqual([newer.id]);
  });

  it('drops a rule once a newer revocation arrives', () => {
    const e = expense({ usdc: '84.00', items: [{ label: 'wine', usdcMicro: u('24.00'), tags: ['alcohol'] }] });
    const r = split(e, [
      rule({ kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } }),
      rule({ kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] }, revoked: true }),
    ]);
    expect(r.shares.ana).toBe(u('21'));
    expect(r.applied).toEqual([]);
  });

  it('ignores rules for absent members and renormalizes weights over who is there', () => {
    const e = expense({ usdc: '1000.00', category: 'rent', participants: ['ana', 'ben', 'clara'] });
    const r = split(e, [
      rule({ kind: 'weights', weights: { ana: 40, ben: 20, clara: 20, dan: 20 }, when: { category: ['rent'] } }),
      rule({ kind: 'covers', member: 'dan', when: { category: ['rent'] } }),
    ]);
    expect(r.shares).toEqual({ ana: u('500'), ben: u('250'), clara: u('250') });
  });

  it('falls back to an equal split and flags a conflict when everyone is excluded', () => {
    const e = expense({ usdc: '10.00', category: 'drinks', participants: ['ana', 'ben'] });
    const r = split(e, [
      rule({ kind: 'exclude', member: 'ana', when: { category: ['drinks'] } }),
      rule({ kind: 'exclude', member: 'ben', when: { category: ['drinks'] } }),
    ]);
    expect(r.shares).toEqual({ ana: u('5'), ben: u('5') });
    expect(r.conflict).toBe(true);
    expect(r.applied).toEqual([]);
  });

  it('matches payer conditions', () => {
    const e = expense({ usdc: '40.00', category: 'groceries', payerId: 'dan' });
    const r = split(e, [rule({ kind: 'exclude', member: 'dan', when: { payer: 'clara' } })]);
    expect(r.shares.dan).toBe(u('10'));
  });

  it('always sums to the total', () => {
    const e = expense({
      usdc: '412.00',
      items: [
        { label: 'wine', usdcMicro: u('140.00'), tags: ['alcohol'] },
        { label: 'steak', usdcMicro: u('61.33'), tags: ['meat'] },
      ],
    });
    const r = split(e, [
      rule({ kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } }),
      rule({ kind: 'exclude', member: 'clara', when: { tags: ['meat'] } }),
    ]);
    expect(total(r.shares)).toBe(e.usdcMicro);
    expect(r.shares.ana! < r.shares.ben!).toBe(true);
  });

  it('rejects items that add up to more than the total', () => {
    const e = expense({ usdc: '10.00', items: [{ label: 'x', usdcMicro: u('11.00'), tags: [] }] });
    expect(() => split(e, [])).toThrow();
  });
});

describe('rule keys', () => {
  it('treats different members as different exclude rules', () => {
    const a = rule({ kind: 'exclude', member: 'ana', when: { tags: ['alcohol'] } });
    const b = rule({ kind: 'exclude', member: 'ben', when: { tags: ['alcohol'] } });
    expect(ruleKey(a)).not.toBe(ruleKey(b));
    expect(supersede([a, b])).toHaveLength(2);
  });

  it('treats a new coverer for the same condition as a replacement', () => {
    const a = rule({ kind: 'covers', member: 'ben', when: { category: ['taxi'] } });
    const b = rule({ kind: 'covers', member: 'dan', when: { category: ['taxi'] } });
    expect(ruleKey(a)).toBe(ruleKey(b));
    expect(supersede([a, b])).toEqual([b]);
  });

  it('normalizes condition order', () => {
    const a = rule({ kind: 'exclude', member: 'ana', when: { tags: ['alcohol', 'meat'] } });
    const b = rule({ kind: 'exclude', member: 'ana', when: { tags: ['meat', 'alcohol'] } });
    expect(ruleKey(a)).toBe(ruleKey(b));
  });

  it('rejects unknown kinds and tags', () => {
    expect(() => RuleSchema.parse({ v: 1, id: 'x', learnedAt: 'now', kind: 'steal', when: {} })).toThrow();
    expect(() => RuleSchema.parse({ v: 1, id: 'x', learnedAt: 'now', kind: 'exclude', member: 'a', when: { tags: ['cigars'] } })).toThrow();
  });
});
