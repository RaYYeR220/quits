import { CENT, MICRO_PER_USDC, type Micro } from '@quits/core';

export function minorDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

const RATE_SCALE = 1_000_000_000n;

function scaledRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) throw new Error(`fx: bad rate ${rate}`);
  const frac = (m[2] ?? '').slice(0, 9).padEnd(9, '0');
  const v = BigInt(m[1] ?? '0') * RATE_SCALE + BigInt(frac);
  if (v === 0n) throw new Error('fx: zero rate');
  return v;
}

/** amountMinor of `currency` → micro-USDC in whole cents, given how many USDC one unit is worth. Rounds half up. */
export function toUsdcMicro(amountMinor: bigint, currency: string, usdcPerFiat: string): Micro {
  const digits = BigInt(minorDigits(currency));
  const num = amountMinor * MICRO_PER_USDC * scaledRate(usdcPerFiat);
  const den = 10n ** digits * RATE_SCALE * CENT;
  return ((num * 2n + den) / (den * 2n)) * CENT;
}

/** Currencies priced 1:1 without a lookup. */
export const PEGGED = new Set(['USD', 'USDC']);
