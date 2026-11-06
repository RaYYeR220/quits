/**
 * Sliding-window budget matching the relayer's per-owner limits
 * (60 points a minute, 500 an hour). `take` waits until the points fit.
 */
export interface Bucket {
  take(points: number): Promise<void>;
  /** Points still available right now in the tighter window. */
  available(): number;
}

export function createBucket(opts: { perMin: number; perHour: number; now?: () => number; sleep?: (ms: number) => Promise<void> }): Bucket {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const spent: { at: number; points: number }[] = [];

  const used = (windowMs: number) => {
    const t = now();
    return spent.filter((s) => t - s.at < windowMs).reduce((a, s) => a + s.points, 0);
  };
  const prune = () => {
    const t = now();
    while (spent.length && t - (spent[0]?.at ?? t) >= 3_600_000) spent.shift();
  };

  return {
    available() {
      prune();
      return Math.min(opts.perMin - used(60_000), opts.perHour - used(3_600_000));
    },
    async take(points) {
      if (points > opts.perMin) throw new Error(`bucket: ${points} points exceed the per-minute budget`);
      for (;;) {
        prune();
        const t = now();
        const minuteOk = used(60_000) + points <= opts.perMin;
        const hourOk = used(3_600_000) + points <= opts.perHour;
        if (minuteOk && hourOk) {
          spent.push({ at: t, points });
          return;
        }
        const window = minuteOk ? 3_600_000 : 60_000;
        const oldest = spent.find((s) => t - s.at < window);
        await sleep(oldest ? window - (t - oldest.at) + 5 : 1_000);
      }
    },
  };
}
