import { describe, expect, it } from 'vitest';
import { allocate, formatUsdc, parseUsdc, sumMicro } from '../src/money.ts';

describe('allocate', () => {
  it('splits a whole-cent total in whole cents, the extra cent to the lowest id', () => {
    const r = allocate(10_000_000n, { a: 1, b: 1, c: 1 });
    expect(r).toEqual({ a: 3_340_000n, b: 3_330_000n, c: 3_330_000n });
    expect(sumMicro(Object.values(r))).toBe(10_000_000n);
  });

  it('never shows four shares of 1.11 for a 4.47 bill', () => {
    const r = allocate(4_470_000n, { ana: 1, ben: 1, clara: 1, dan: 1 });
    expect(Object.values(r).sort()).toEqual([1_110_000n, 1_120_000n, 1_120_000n, 1_120_000n].sort());
    expect(sumMicro(Object.values(r))).toBe(4_470_000n);
  });

  it('keeps micro-USDC precision for a total that is not whole cents', () => {
    const r = allocate(10_000_001n, { a: 1, b: 1, c: 1 });
    expect(r).toEqual({ a: 3_333_334n, b: 3_333_334n, c: 3_333_333n });
    expect(sumMicro(Object.values(r))).toBe(10_000_001n);
  });

  it('respects weights exactly when they divide', () => {
    expect(allocate(1_000_000_000n, { a: 40, b: 20, c: 20, d: 20 })).toEqual({
      a: 400_000_000n,
      b: 200_000_000n,
      c: 200_000_000n,
      d: 200_000_000n,
    });
  });

  it('gives zero to a zero-weight member', () => {
    const r = allocate(9_000_000n, { a: 1, b: 0, c: 2 });
    expect(r.b).toBe(0n);
    expect((r.a ?? 0n) + (r.c ?? 0n)).toBe(9_000_000n);
  });

  it('keeps the sum exact for awkward totals', () => {
    const r = allocate(1n, { a: 1, b: 1, c: 1 });
    expect(sumMicro(Object.values(r))).toBe(1n);
    expect(r).toEqual({ a: 1n, b: 0n, c: 0n });
  });

  it('throws when every weight is zero', () => {
    expect(() => allocate(5n, { a: 0, b: 0 })).toThrow();
  });

  it('throws on negative weights or totals', () => {
    expect(() => allocate(5n, { a: -1, b: 2 })).toThrow();
    expect(() => allocate(-5n, { a: 1 })).toThrow();
  });
});

describe('formatting', () => {
  it('formats micro-USDC with two decimals by default', () => {
    expect(formatUsdc(12_340_000n)).toBe('12.34');
    expect(formatUsdc(5n)).toBe('0.00');
    expect(formatUsdc(-1_500_000n)).toBe('-1.50');
  });

  it('formats with full precision on request', () => {
    expect(formatUsdc(12_345_678n, 6)).toBe('12.345678');
  });

  it('parses decimal strings', () => {
    expect(parseUsdc('0.01')).toBe(10_000n);
    expect(parseUsdc('12.34')).toBe(12_340_000n);
    expect(parseUsdc('7')).toBe(7_000_000n);
    expect(() => parseUsdc('1.2345678')).toThrow();
    expect(() => parseUsdc('abc')).toThrow();
  });
});
