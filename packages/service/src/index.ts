import { eq } from 'drizzle-orm';
import { users } from '@quits/db';
import { nsMember } from '@quits/memory';
import { makeCtx, type Ctx, type Ports } from './context.ts';
import * as ex from './expenses.ts';
import * as gr from './groups.ts';
import * as lr from './learned.ts';
import * as dbt from './debts.ts';
import * as au from './autosettle.ts';
import { drainMemoryQueue, flushMemory } from './memoryQueue.ts';
import * as demo from './demo.ts';

export type { Ports, FxPort } from './context.ts';
export { QuitsError } from './context.ts';
export type { Proposal, Why, AddResult, CorrectResult } from './expenses.ts';
export type { ListedRule, RuleState } from './learned.ts';
export type { DebtRow, PaidMethod } from './debts.ts';
export type { Decision } from './autosettle.ts';
export { limitFrom, STARTING_LIMIT } from './autosettle.ts';
export { toUsdcMicro, minorDigits } from './fx.ts';
export { DEMO_MEMBERS, DEMO_FLAT, DEMO_TRIP } from './demo.ts';

type Rest<F> = F extends (ctx: Ctx, ...rest: infer R) => unknown ? R : never;

export function createQuits(ports: Ports) {
  const ctx: Ctx = makeCtx(ports);
  return {
    ctx,
    // people and groups
    ensureUser: (...a: Rest<typeof gr.ensureUser>) => gr.ensureUser(ctx, ...a),
    createGroup: (...a: Rest<typeof gr.createGroup>) => gr.createGroup(ctx, ...a),
    addMember: (...a: Rest<typeof gr.addMember>) => gr.addMember(ctx, ...a),
    joinByCode: (...a: Rest<typeof gr.joinByCode>) => gr.joinByCode(ctx, ...a),
    group: (...a: Rest<typeof gr.getGroup>) => gr.getGroup(ctx, ...a),
    members: (...a: Rest<typeof gr.groupMembers>) => gr.groupMembers(ctx, ...a),
    groupsOf: (...a: Rest<typeof gr.userGroups>) => gr.userGroups(ctx, ...a),
    assertMember: (...a: Rest<typeof gr.assertMember>) => gr.assertMember(ctx, ...a),

    // expenses and learning
    addExpenseFromText: (...a: Rest<typeof ex.addExpenseFromText>) => ex.addExpenseFromText(ctx, ...a),
    addExpense: (...a: Rest<typeof ex.addExpense>) => ex.addExpense(ctx, ...a),
    accept: (...a: Rest<typeof ex.accept>) => ex.accept(ctx, ...a),
    correct: (...a: Rest<typeof ex.correct>) => ex.correct(ctx, ...a),
    replay: (...a: Rest<typeof ex.replay>) => ex.replay(ctx, ...a),
    expenses: (...a: Rest<typeof ex.listExpenses>) => ex.listExpenses(ctx, ...a),
    learnRule: (...a: Rest<typeof lr.learnRule>) => lr.learnRule(ctx, ...a),
    async rules(groupId: string) {
      const ms = await gr.groupMembers(ctx, groupId);
      return lr.listRules(ctx, groupId, ms.map((m) => m.id));
    },
    async rebuildFromWalrus(groupId: string) {
      const ms = await gr.groupMembers(ctx, groupId);
      return lr.rebuildFromWalrus(ctx, groupId, ms.map((m) => m.id));
    },

    // memory
    drainMemory: (...a: Rest<typeof drainMemoryQueue>) => drainMemoryQueue(ctx, ...a),
    flushMemory: () => flushMemory(ctx),
    /** Routes a member's portable memory to their own Walrus Memory account after checking we can use it. */
    async setOwnMemoryAccount(userId: string, accountId: string): Promise<{ ok: true } | { ok: false; reason: 'unreachable' | 'delegate_not_added' }> {
      if (!(await ctx.memory.health({ accountId }))) return { ok: false, reason: 'unreachable' };
      try {
        await ctx.memory.recall(nsMember(userId), 'probe', { topK: 1, accountId });
      } catch {
        return { ok: false, reason: 'delegate_not_added' };
      }
      await ctx.db.update(users).set({ memwalAccountId: accountId }).where(eq(users.id, userId));
      return { ok: true };
    },

    // money
    balances: (...a: Rest<typeof dbt.groupBalances>) => dbt.groupBalances(ctx, ...a),
    refreshDebts: (...a: Rest<typeof dbt.refreshDebts>) => dbt.refreshDebts(ctx, ...a),
    debt: (...a: Rest<typeof dbt.getDebt>) => dbt.getDebt(ctx, ...a),
    markPaid: (...a: Rest<typeof dbt.markPaid>) => dbt.markPaid(ctx, ...a),
    markRecorded: (...a: Rest<typeof dbt.markRecorded>) => dbt.markRecorded(ctx, ...a),
    cancelDebt: (...a: Rest<typeof dbt.cancelDebt>) => dbt.cancelDebt(ctx, ...a),
    learnedLimit: (...a: Rest<typeof au.learnedLimit>) => au.learnedLimit(ctx, ...a),
    autoSettleDecision: (...a: Rest<typeof au.autoSettleDecision>) => au.autoSettleDecision(ctx, ...a),
    decide: (...a: Rest<typeof au.decide>) => au.decide(ctx, ...a),
    activeMandate: (...a: Rest<typeof au.activeMandate>) => au.activeMandate(ctx, ...a),

    // demo
    seedDemo: (...a: Rest<typeof demo.seedDemo>) => demo.seedDemo(ctx, ...a),
  };
}

export type Quits = ReturnType<typeof createQuits>;
