/** Money is always an integer count of micro-USDC (6 decimals). */
export type Micro = bigint;

export const USDC_DECIMALS = 6;
export const MICRO_PER_USDC = 1_000_000n;
/** Smallest amount Sui moves as a gasless stablecoin transfer (0.01 USDC). */
export const GASLESS_FLOOR: Micro = 10_000n;

const WEIGHT_SCALE = 1_000_000;

export function sumMicro(values: Iterable<Micro>): Micro {
  let s = 0n;
  for (const v of values) s += v;
  return s;
}

/** One cent of USDC. Bills are kept in whole cents so the shares people see add up. */
export const CENT: Micro = 10_000n;

/** Exact shares are carried at this many sub-units per micro-USDC before the one final rounding. */
export const EXACT_SCALE = 1_000_000_000_000n;

/**
 * Exact (scaled by EXACT_SCALE) proportional parts of `amount` for `weights`,
 * with no rounding yet. Add these up across a bill's lines, then `apportion` once.
 */
export function exactParts(amount: Micro, weights: Record<string, number>): Record<string, bigint> {
  if (amount < 0n) throw new Error('allocate: total must be non-negative');
  const ids = Object.keys(weights).sort();
  const scaled = ids.map((id) => {
    const w = weights[id] ?? 0;
    if (!Number.isFinite(w) || w < 0) throw new Error(`allocate: bad weight for ${id}`);
    return BigInt(Math.round(w * WEIGHT_SCALE));
  });
  const weightSum = sumMicro(scaled);
  if (weightSum === 0n) throw new Error('allocate: all weights are zero');
  return Object.fromEntries(ids.map((id, i) => [id, (amount * EXACT_SCALE * (scaled[i] ?? 0n)) / weightSum]));
}

/**
 * Rounds exact shares to `total`, once: a total in whole cents becomes whole-cent
 * shares, anything else whole micro-USDC. Every share is floored, then the leftover
 * units go one at a time to the largest remainders (ties to the lowest id), so the
 * shares add up to `total` exactly and none is more than one unit from exact.
 * 4.47 between four is 1.12 + 1.12 + 1.12 + 1.11.
 */
export function apportion(total: Micro, exact: Record<string, bigint>): Record<string, Micro> {
  if (total < 0n) throw new Error('allocate: total must be non-negative');
  const unit = total > 0n && total % CENT === 0n ? CENT : 1n;
  const per = EXACT_SCALE * unit;
  const ids = Object.keys(exact).sort();
  const out: Record<string, Micro> = {};
  const remainders: { id: string; rem: bigint }[] = [];
  let given = 0n;
  for (const id of ids) {
    const x = exact[id] ?? 0n;
    const q = x / per;
    out[id] = q * unit;
    given += q;
    remainders.push({ id, rem: x % per });
  }
  let left = total / unit - given;
  remainders.sort((x, y) => (x.rem === y.rem ? (x.id < y.id ? -1 : 1) : x.rem > y.rem ? -1 : 1));
  for (const r of remainders) {
    if (left <= 0n) break;
    if ((exact[r.id] ?? 0n) === 0n) continue;
    out[r.id] = (out[r.id] ?? 0n) + unit;
    left -= 1n;
  }
  return out;
}

/**
 * Splits `total` across members in proportion to `weights`: exact parts, rounded
 * once by `apportion`, so the shares always add up to `total` exactly.
 */
export function allocate(total: Micro, weights: Record<string, number>): Record<string, Micro> {
  return apportion(total, exactParts(total, weights));
}

export function formatUsdc(m: Micro, decimals = 2): string {
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const whole = abs / MICRO_PER_USDC;
  const frac = (abs % MICRO_PER_USDC).toString().padStart(USDC_DECIMALS, '0').slice(0, decimals);
  return `${neg ? '-' : ''}${whole}${decimals > 0 ? `.${frac}` : ''}`;
}

export function parseUsdc(s: string): Micro {
  const m = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) throw new Error(`parseUsdc: not a USDC amount: ${s}`);
  const [, neg, whole, frac = ''] = m;
  const v = BigInt(whole ?? '0') * MICRO_PER_USDC + BigInt(frac.padEnd(USDC_DECIMALS, '0'));
  return neg ? -v : v;
}
