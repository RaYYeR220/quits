import { toExpense } from '../expenses.ts';
import { evenSplit } from '../member.ts';
import type { Proposal, System } from './types.ts';

/** What every split app does by default: everyone who was there pays the same. Never learns. */
export const equal: System = {
  name: 'equal',
  usesLlm: false,
  async start() {
    let current: Proposal = { invalid: 'nothing proposed yet' };
    return {
      async propose(x) {
        current = { shares: evenSplit(toExpense(x)) };
        return current;
      },
      async correct() {
        return { proposal: current };
      },
      async settle() {},
    };
  },
};
