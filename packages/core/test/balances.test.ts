import { describe, expect, it } from 'vitest';
import { balances, settleUp } from '../src/balances.ts';
import { parseUsdc as u, sumMicro } from '../src/money.ts';

describe('balances', () => {
  it('credits the payer and debits each share', () => {
    const b = balances(
      [
        { payerId: 'clara', usdcMicro: u('84'), shares: { ana: u('15'), ben: u('23'), clara: u('23'), dan: u('23') } },
        { payerId: 'ben', usdcMicro: u('20'), shares: { ana: u('5'), ben: u('5'), clara: u('5'), dan: u('5') } },
      ],
      [],
    );
    expect(b).toEqual({ ana: -u('20'), ben: u('-8') + u('0'), clara: u('56'), dan: -u('28') });
    expect(sumMicro(Object.values(b))).toBe(0n);
  });

  it('applies settlements', () => {
    const b = balances(
      [{ payerId: 'ana', usdcMicro: u('10'), shares: { ana: u('5'), ben: u('5') } }],
      [{ from: 'ben', to: 'ana', usdcMicro: u('5') }],
    );
    expect(b).toEqual({ ana: 0n, ben: 0n });
  });

  it('rejects shares that do not add up', () => {
    expect(() => balances([{ payerId: 'a', usdcMicro: u('10'), shares: { a: u('4'), b: u('5') } }], [])).toThrow();
  });
});

describe('settleUp', () => {
  it('minimizes the number of transfers', () => {
    const t = settleUp({ a: u('30'), b: -u('10'), c: -u('20') });
    expect(t).toEqual([
      { from: 'c', to: 'a', usdcMicro: u('20') },
      { from: 'b', to: 'a', usdcMicro: u('10') },
    ]);
  });

  it('chains through several creditors', () => {
    const t = settleUp({ a: u('15'), b: u('5'), c: -u('12'), d: -u('8') });
    expect(t).toEqual([
      { from: 'c', to: 'a', usdcMicro: u('12') },
      { from: 'd', to: 'b', usdcMicro: u('5') },
      { from: 'd', to: 'a', usdcMicro: u('3') },
    ]);
  });

  it('drops transfers below the gasless floor', () => {
    expect(settleUp({ a: 9_999n, b: -9_999n })).toEqual([]);
    expect(settleUp({ a: 10_000n, b: -10_000n })).toEqual([{ from: 'b', to: 'a', usdcMicro: 10_000n }]);
  });

  it('is empty when everyone is quits', () => {
    expect(settleUp({ a: 0n, b: 0n })).toEqual([]);
  });

  it('throws when balances do not net to zero', () => {
    expect(() => settleUp({ a: 5n, b: -4n })).toThrow();
  });
});
