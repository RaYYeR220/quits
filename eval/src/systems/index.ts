import { equal } from './equal.ts';
import { llmFullHistory, llmNoMemory } from './llm.ts';
import { quits, quitsMemoryOff } from './quits.ts';
import type { System, SystemName } from './types.ts';

export * from './types.ts';

export const SYSTEM_BY_NAME: Record<SystemName, System> = {
  equal,
  'llm-no-memory': llmNoMemory,
  'llm-full-history': llmFullHistory,
  quits,
  'quits-memory-off': quitsMemoryOff,
};
