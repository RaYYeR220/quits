import { z } from 'zod';
import { RuleSchema } from './rules.ts';

/**
 * A Quits memory is a plain sentence a person can read, followed by a machine
 * tail: `⟦quits:v1 {...}⟧`. Only a valid tail at the very end of the text is
 * trusted; anything else is kept as a readable fact and never applied.
 */
export const MemoryPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rule'), scope: z.enum(['group', 'member']), rule: RuleSchema }).strict(),
  z
    .object({
      kind: z.literal('event'),
      event: z.enum(['expense', 'correction', 'settlement', 'approval', 'objection']),
      data: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ kind: z.literal('limit'), member: z.string().min(1), usdcMicro: z.string().regex(/^\d+$/) }).strict(),
]);
export type MemoryPayload = z.infer<typeof MemoryPayloadSchema>;

const OPEN = '⟦quits:v1 ';
const CLOSE = '⟧';
const TAIL = /\s*⟦quits:v1 (\{.*\})⟧\s*$/su;
const ANY_TAIL = /⟦[^⟧]*⟧/gu;

function clean(sentence: string): string {
  return sentence.replace(ANY_TAIL, ' ').replace(/\s+/gu, ' ').trim();
}

export function encodeMemory(sentence: string, payload: MemoryPayload): string {
  const valid = MemoryPayloadSchema.parse(payload);
  return `${clean(sentence)} ${OPEN}${JSON.stringify(valid)}${CLOSE}`;
}

export function decodeMemory(text: string): { sentence: string; payload: MemoryPayload | null } {
  const m = TAIL.exec(text);
  if (!m) return { sentence: clean(text), payload: null };
  const sentence = clean(text.slice(0, m.index));
  try {
    const parsed = MemoryPayloadSchema.safeParse(JSON.parse(m[1] ?? ''));
    return { sentence, payload: parsed.success ? parsed.data : null };
  } catch {
    return { sentence, payload: null };
  }
}
