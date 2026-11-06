/** mulberry32: tiny, fast, and the same sequence on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the parts, for deriving independent sub-seeds from names. */
export function hash(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('\u0000')) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(xs: readonly T[]): T;
  /** A price between `lo` and `hi` dollars, in cents. */
  cents(lo: number, hi: number): number;
  shuffle<T>(xs: readonly T[]): T[];
}

export function rng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (xs) => {
      if (xs.length === 0) throw new Error('rng.pick: empty list');
      return xs[int(0, xs.length - 1)] as (typeof xs)[number];
    },
    cents: (lo, hi) => int(Math.round(lo * 100), Math.round(hi * 100)),
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
}
