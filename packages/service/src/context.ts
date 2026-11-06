import { randomUUID } from 'node:crypto';
import type { Db } from '@quits/db';
import type { Llm } from '@quits/llm';
import type { MemoryStore } from '@quits/memory';

/** Converts a fiat currency to USDC. Throws when it can't price the currency. */
export interface FxPort {
  /** How many USDC one unit of `fiat` is worth (e.g. "1.16" for EUR). */
  usdcPerFiat(fiat: string): Promise<{ rate: string; source: string; at: string }>;
}

export interface Ports {
  db: Db;
  memory: MemoryStore;
  llm: Llm;
  fx: FxPort;
  clock?: () => Date;
  ids?: () => string;
  /** Turning memory off makes every split equal: the ablation behind the benchmark. */
  memoryEnabled?: boolean;
}

export interface Ctx {
  db: Db;
  memory: MemoryStore;
  llm: Llm;
  fx: FxPort;
  now: () => Date;
  id: () => string;
  memoryEnabled: boolean;
}

export function makeCtx(p: Ports): Ctx {
  return {
    db: p.db,
    memory: p.memory,
    llm: p.llm,
    fx: p.fx,
    now: p.clock ?? (() => new Date()),
    id: p.ids ?? (() => randomUUID()),
    memoryEnabled: p.memoryEnabled ?? true,
  };
}

export class QuitsError extends Error {
  constructor(
    public readonly code: 'not_found' | 'forbidden' | 'invalid' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}
