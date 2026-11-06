export interface Limiter {
  /** Resolves once a call may start. Calls are admitted in FIFO order. */
  take(): Promise<void>;
}

export interface LimiterOptions {
  /** Most calls allowed to start within any `windowMs`. */
  rps: number;
  windowMs?: number;
}

/** Sliding-window limiter: never more than `rps` call starts in any window. */
export function createLimiter({ rps, windowMs = 1000 }: LimiterOptions): Limiter {
  if (!Number.isInteger(rps) || rps < 1) throw new Error(`limiter: rps must be a positive integer, got ${rps}`);
  const starts: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  const admit = async () => {
    for (;;) {
      const now = Date.now();
      while (starts.length > 0 && now - starts[0]! >= windowMs) starts.shift();
      if (starts.length < rps) {
        starts.push(now);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, windowMs - (now - starts[0]!)));
    }
  };

  return {
    take() {
      const turn = queue.then(admit);
      queue = turn;
      return turn;
    },
  };
}

/** Tatum's free plan allows 3 requests per second per key. */
export const TATUM_FREE_RPS = 3;

const perKey = new Map<string, Limiter>();

/** One limiter per API key, shared by every client that uses that key. */
export function sharedLimiter(apiKey: string, rps = TATUM_FREE_RPS): Limiter {
  let limiter = perKey.get(apiKey);
  if (!limiter) {
    limiter = createLimiter({ rps });
    perKey.set(apiKey, limiter);
  }
  return limiter;
}
