import { allocate, formatUsdc, parseUsdc, type Rule } from '@quits/core';
import type { Llm } from '@quits/llm';
import { GROUPS } from './groups.ts';

/** Every scripted correction, mapped back to the rule it states. */
const PHRASES = new Map<string, Rule>(
  Object.values(GROUPS).flatMap((g) => g.hidden.flatMap((h) => h.say.map((s) => [s, h.rule] as const))),
);

function compiled(r: Rule) {
  const rule = {
    kind: r.kind,
    when: r.when,
    ...(r.kind === 'exclude' || r.kind === 'covers' ? { member: r.member } : {}),
    ...(r.kind === 'only' ? { members: r.members } : {}),
    ...(r.kind === 'weights' ? { weights: Object.entries(r.weights).map(([member, weight]) => ({ member, weight })) } : {}),
  };
  return { status: 'rule', scope: r.kind === 'exclude' ? 'member' : 'group', sentence: r.id, rule };
}

function equalShares(user: string) {
  const block = user.slice(user.lastIndexOf('Expense to split:'));
  const total = /^total: ([\d.]+) USD$/m.exec(block)?.[1];
  const people = /^participants: (.+)$/m.exec(block)?.[1]?.split(',').map((s) => s.trim());
  if (!total || !people?.length) return { shares: [] };
  const parts = allocate(parseUsdc(total), Object.fromEntries(people.map((p) => [p, 1])));
  return { shares: Object.entries(parts).map(([member, v]) => ({ member, amount: formatUsdc(v, 6) })) };
}

const tokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Offline stand-in for CI. Compiles the benchmark's own correction phrases
 * perfectly and always proposes an even split, so a run exercises every code
 * path without a network. Its numbers are not a result.
 */
export function fakeLlm(): Llm {
  return {
    async raw(system, user, opts) {
      let answer: unknown;
      if (opts?.name === 'correction') {
        const text = /<correction>\n([\s\S]*?)\n<\/correction>/.exec(user)?.[1]?.trim() ?? '';
        const rule = PHRASES.get(text);
        answer = rule ? compiled(rule) : { status: 'clarify', clarify: 'Who should this apply to?' };
      } else if (opts?.name === 'shares') {
        answer = equalShares(user);
      } else {
        throw new Error(`fake llm: no script for ${opts?.name ?? 'unnamed'} prompts`);
      }
      const content = JSON.stringify(answer);
      return { content, usage: { prompt: tokens(system) + tokens(user), completion: tokens(content) } };
    },
  };
}
