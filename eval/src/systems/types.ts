import type { Rule } from '@quits/core';
import type { Llm } from '@quits/llm';
import type { EvalExpense } from '../expenses.ts';
import type { GroupDef } from '../groups.ts';
import type { Shares } from '../member.ts';

export const SYSTEMS = ['equal', 'llm-no-memory', 'llm-full-history', 'quits', 'quits-memory-off'] as const;
export type SystemName = (typeof SYSTEMS)[number];

/** A split the member can check, or an answer that couldn't be used at all. */
export type Proposal = { shares: Shares } | { invalid: string };

export interface CorrectionNote {
  learned?: { sentence: string; rule: Rule | null };
  /** Taken as a fact about this expense only (who was there, who paid); nothing learned. */
  fixed?: { absent: string[]; payer?: string };
  clarify?: string;
  error?: string;
}

/** One system working through one group's expenses, in order. */
export interface Session {
  propose(x: EvalExpense): Promise<Proposal>;
  /** The member's correction on the expense just proposed. */
  correct(text: string, by: string): Promise<{ proposal: Proposal; note?: CorrectionNote }>;
  /** The member is done with this expense; `final` is what got posted. */
  settle(final: Shares, handFixed: boolean): Promise<void>;
}

export interface System {
  name: SystemName;
  usesLlm: boolean;
  start(g: GroupDef, llm: Llm): Promise<Session>;
}
