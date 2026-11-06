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

/**
 * Splits `total` across members in proportion to `weights`.
 * Floors every share, then hands the leftover units one at a time to the
 * largest fractional remainders (ties broken by member id, ascending), so the
 * shares always add up to `total` exactly.
 */
export function allocate(total: Micro, weights: Record<string, number>): Record<string, Micro> {
  if (total < 0n) throw new Error('allocate: total must be non-negative');
  const ids = Object.keys(weights).sort();
  const scaled = ids.map((id) => {
    const w = weights[id] ?? 0;
    if (!Number.isFinite(w) || w < 0) throw new Error(`allocate: bad weight for ${id}`);
    return BigInt(Math.round(w * WEIGHT_SCALE));
  });
  const weightSum = sumMicro(scaled);
  if (weightSum === 0n) throw new Error('allocate: all weights are zero');

  const out: Record<string, Micro> = {};
  const remainders: { id: string; rem: bigint }[] = [];
  let given = 0n;
  ids.forEach((id, i) => {
    const num = total * (scaled[i] ?? 0n);
    const share = num / weightSum;
    out[id] = share;
    given += share;
    remainders.push({ id, rem: num % weightSum });
  });

  let left = total - given;
  remainders.sort((x, y) => (x.rem === y.rem ? (x.id < y.id ? -1 : 1) : x.rem > y.rem ? -1 : 1));
  for (const r of remainders) {
    if (left === 0n) break;
    if ((weights[r.id] ?? 0) === 0) continue;
    out[r.id] = (out[r.id] ?? 0n) + 1n;
    left -= 1n;
  }
  return out;
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
