import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const micro = (name: string) => bigint(name, { mode: 'bigint' });

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  suiAddress: text('sui_address').unique(),
  authProvider: text('auth_provider', { enum: ['zklogin', 'wallet', 'demo', 'telegram'] }).notNull(),
  /** Set when the member keeps their memory in their own Walrus Memory account. */
  memwalAccountId: text('memwal_account_id'),
  createdAt: created(),
});

export const groups = pgTable('groups', {
  id: id(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  defaultCurrency: text('default_currency').notNull().default('USD'),
  createdBy: text('created_by').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: created(),
});

export const members = pgTable(
  'members',
  {
    groupId: text('group_id').notNull().references(() => groups.id),
    userId: text('user_id').notNull().references(() => users.id),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
    joinedAt: created(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    groupId: text('group_id').notNull().references(() => groups.id),
    payerId: text('payer_id').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    currency: text('currency').notNull(),
    amountMinor: micro('amount_minor').notNull(),
    fxRate: text('fx_rate'),
    fxSource: text('fx_source'),
    fxAt: timestamp('fx_at', { withTimezone: true }),
    usdcMicro: micro('usdc_micro').notNull(),
    participants: text('participants').array().notNull(),
    items: jsonb('items').$type<{ label: string; usdcMicro: string; tags: string[] }[]>().notNull().default(sql`'[]'::jsonb`),
    /** Rules the split used, with the memory each came from. */
    applied: jsonb('applied').$type<{ ruleId: string; target: 'expense' | number }[]>().notNull().default(sql`'[]'::jsonb`),
    status: text('status', { enum: ['draft', 'posted', 'void'] }).notNull().default('draft'),
    source: text('source', { enum: ['web', 'telegram', 'mcp', 'seed', 'eval'] }).notNull().default('web'),
    rawText: text('raw_text'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
  },
  (t) => [index('expenses_group_idx').on(t.groupId, t.occurredAt)],
);

export const shares = pgTable(
  'shares',
  {
    expenseId: text('expense_id').notNull().references(() => expenses.id),
    memberId: text('member_id').notNull(),
    usdcMicro: micro('usdc_micro').notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const memories = pgTable(
  'memories',
  {
    id: id(),
    ns: text('ns').notNull(),
    kind: text('kind', { enum: ['rule', 'event', 'limit'] }).notNull(),
    text: text('text').notNull(),
    /** Member-owned Walrus Memory account; null = operator account. */
    accountId: text('account_id'),
    jobId: text('job_id'),
    blobId: text('blob_id'),
    state: text('state', { enum: ['queued', 'submitted', 'done', 'failed'] }).notNull().default('queued'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: created(),
    storedAt: timestamp('stored_at', { withTimezone: true }),
  },
  (t) => [index('memories_state_idx').on(t.state), index('memories_ns_idx').on(t.ns)],
);

export const rules = pgTable(
  'rules',
  {
    id: id(),
    scope: text('scope', { enum: ['group', 'member'] }).notNull(),
    groupId: text('group_id'),
    userId: text('user_id'),
    kind: text('kind').notNull(),
    /** The full Rule object (core RuleSchema). */
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    sentence: text('sentence').notNull(),
    learnedAt: timestamp('learned_at', { withTimezone: true }).notNull(),
    memoryId: text('memory_id').references(() => memories.id),
    sourceExpenseId: text('source_expense_id'),
    createdBy: text('created_by'),
  },
  (t) => [index('rules_group_idx').on(t.groupId), index('rules_user_idx').on(t.userId)],
);

export const corrections = pgTable('corrections', {
  id: id(),
  expenseId: text('expense_id').notNull().references(() => expenses.id),
  userId: text('user_id').notNull(),
  text: text('text').notNull(),
  ruleId: text('rule_id'),
  clarify: text('clarify'),
  createdAt: created(),
});

export const debts = pgTable(
  'debts',
  {
    id: id(),
    groupId: text('group_id').notNull().references(() => groups.id),
    debtorId: text('debtor_id').notNull(),
    creditorId: text('creditor_id').notNull(),
    usdcMicro: micro('usdc_micro').notNull(),
    status: text('status', {
      enum: ['open', 'recorded', 'settled_wallet', 'settled_agent', 'settled_external', 'cancelled'],
    })
      .notNull()
      .default('open'),
    mandateId: text('mandate_id'),
    onchainDebtId: text('onchain_debt_id'),
    pullableAt: timestamp('pullable_at', { withTimezone: true }),
    txDigest: text('tx_digest').unique(),
    createdAt: created(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [index('debts_group_idx').on(t.groupId, t.status)],
);

export const mandates = pgTable('mandates', {
  id: id(),
  userId: text('user_id').notNull(),
  groupId: text('group_id').notNull(),
  allowanceId: text('allowance_id').notNull(),
  mandateObjectId: text('mandate_object_id').notNull().unique(),
  lifetimeCap: micro('lifetime_cap').notNull(),
  weeklyLimit: micro('weekly_limit').notNull(),
  maxPerDebt: micro('max_per_debt').notNull(),
  objectionWindowMs: bigint('objection_window_ms', { mode: 'number' }).notNull(),
  creditors: text('creditors').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
  openTx: text('open_tx').notNull(),
  createdAt: created(),
});

export const approvals = pgTable('approvals', {
  id: id(),
  debtId: text('debt_id').notNull().references(() => debts.id),
  userId: text('user_id').notNull(),
  decision: text('decision', { enum: ['approve', 'object'] }).notNull(),
  createdAt: created(),
});

export const tatumCalls = pgTable(
  'tatum_calls',
  {
    id: serial('id').primaryKey(),
    surface: text('surface', { enum: ['grpc', 'graphql', 'data'] }).notNull(),
    method: text('method').notNull(),
    ms: integer('ms').notNull(),
    ok: boolean('ok').notNull(),
    at: created(),
  },
  (t) => [index('tatum_calls_at_idx').on(t.at)],
);

export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const apiTokens = pgTable('api_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  label: text('label').notNull(),
  createdAt: created(),
});

export const telegramLinks = pgTable(
  'telegram_links',
  {
    chatId: text('chat_id').notNull(),
    groupId: text('group_id').notNull().references(() => groups.id),
    createdAt: created(),
  },
  (t) => [uniqueIndex('telegram_chat_idx').on(t.chatId)],
);

export const telegramUsers = pgTable('telegram_users', {
  telegramUserId: text('telegram_user_id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
});

/** One row per payment being settled: the digest ↔ debt reservation behind x402 idempotency. */
export const paymentClaims = pgTable('payment_claims', {
  digest: text('digest').primaryKey(),
  debtId: text('debt_id').notNull().unique(),
  settled: boolean('settled').notNull().default(false),
  createdAt: created(),
});
