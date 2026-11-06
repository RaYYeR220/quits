import type { Llm } from '../src/client.ts';

/** An Llm that returns queued raw outputs in order and records the prompts it saw. */
export function fakeLlm(outputs: unknown[]): Llm & { prompts: { system: string; user: string }[] } {
  const queue = [...outputs];
  const prompts: { system: string; user: string }[] = [];
  return {
    prompts,
    async raw(system, user) {
      prompts.push({ system, user });
      if (queue.length === 0) throw new Error('fakeLlm: no more outputs');
      return { content: JSON.stringify(queue.shift()), usage: { prompt: 100, completion: 20 } };
    },
  };
}
