import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { fromBase64, normalizeStructTag, normalizeSuiAddress, parseStructTag } from '@mysten/sui/utils';
import { isValidTransactionSignature } from '@mysten/sui/verify';
import type { SettlementStore } from './store.ts';

/** A signed, not yet executed Sui transaction offered as payment. */
export interface SuiPayment {
  txBytesB64: string;
  signatures: string[];
}

/** What the payment must do to settle the debt. */
export interface PaymentExpectation {
  /** Quits debt id (the on-chain `Debt.reference` on the agent path). */
  debtId: string;
  debtor: string;
  creditor: string;
  /** Exact amount the creditor must receive, in base units of `coinType`. */
  amount: bigint;
  /** The settlement agent, allowed to pay through `quits::settle::settle`. */
  agent: string;
  quitsPkg: string;
  coinType: string;
  /** The debt's creation time; a transfer checkpointed earlier can't have paid it. */
  notBeforeMs?: number;
}

export type SettleFailure =
  | 'malformed'
  | 'bad_signature'
  | 'bad_sender'
  | 'wrong_debt'
  | 'wrong_amount'
  | 'wrong_recipient'
  | 'simulate_failed'
  | 'execute_failed'
  | 'already_settled'
  | 'digest_reused'
  | 'in_progress';

export type SettleResult =
  | { ok: true; digest: string; payer: string; via: 'wallet' | 'agent' }
  | { ok: false; reason: SettleFailure; detail?: string; digest?: string };

const DebtSettledBcs = bcs.struct('DebtSettled', {
  debt: bcs.Address,
  reference: bcs.string(),
  debtor: bcs.Address,
  creditor: bcs.Address,
  amount: bcs.u64(),
  status: bcs.u8(),
});

type Effects = Pick<SuiClientTypes.Transaction<{ balanceChanges: true; events: true }>, 'balanceChanges' | 'events'>;
export type SettleRefusal = Extract<SettleResult, { ok: false }>;

export function refuse(reason: SettleFailure, detail?: string, digest?: string): SettleRefusal {
  return { ok: false, reason, ...(detail ? { detail } : {}), ...(digest ? { digest } : {}) };
}

/**
 * x402 `exact` verification and settlement on Sui. Checks the sender (debtor,
 * or the agent calling only `quits::settle::settle` for this debt), the
 * signature, and a simulation in which the creditor gains exactly `amount`;
 * then executes once. A debt settled before returns `already_settled` with the
 * first digest, and a settlement still running returns `in_progress`; neither
 * executes anything.
 */
export async function verifyAndSettle(
  client: ClientWithCoreApi,
  payment: SuiPayment,
  expect: PaymentExpectation,
  { store }: { store: SettlementStore },
): Promise<SettleResult> {
  let bytes: Uint8Array;
  let data: ReturnType<Transaction['getData']>;
  let digest: string;
  try {
    bytes = fromBase64(payment.txBytesB64);
    data = Transaction.from(bytes).getData();
    digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  } catch (err) {
    return refuse('malformed', errorMessage(err));
  }

  const replay = await priorSettlement(store, digest, expect.debtId);
  if (replay) return replay;

  const sender = data.sender ? normalizeSuiAddress(data.sender) : '';
  const via = sender === normalizeSuiAddress(expect.debtor) ? 'wallet' : sender === normalizeSuiAddress(expect.agent) ? 'agent' : null;
  if (!via) return refuse('bad_sender', `sender ${sender || 'missing'} is neither the debtor nor the agent`);
  if (via === 'agent' && !isOnlySettleCall(data, expect.quitsPkg)) {
    return refuse('bad_sender', 'agent payments may only call quits::settle::settle');
  }

  let signed = false;
  try {
    for (const signature of payment.signatures) {
      if (await isValidTransactionSignature(bytes, signature, { address: sender, client })) signed = true;
    }
  } catch (err) {
    return refuse('bad_signature', `signature could not be checked: ${errorMessage(err)}`);
  }
  if (!signed) return refuse('bad_signature', 'no valid signature from the sender');

  let simulated: SuiClientTypes.SimulateTransactionResult<{ balanceChanges: true; events: true }>;
  try {
    simulated = await client.core.simulateTransaction({ transaction: bytes, include: { balanceChanges: true, events: true } });
  } catch (err) {
    return refuse('simulate_failed', errorMessage(err));
  }
  if (simulated.$kind === 'FailedTransaction') {
    return refuse('simulate_failed', executionMessage(simulated.FailedTransaction.status));
  }
  const planned = checkEffects(simulated.Transaction, expect, via);
  if (planned) return planned;

  if (!(await store.claim(digest, expect.debtId))) {
    return (await priorSettlement(store, digest, expect.debtId)) ?? refuse('in_progress', 'this debt is being settled right now');
  }

  // A signed transaction is public once it runs. Only one that has never run can pay this debt.
  const ran = await alreadyExecuted(client, digest);
  if (ran !== false) {
    await store.release(digest, expect.debtId);
    return ran === true ? refuse('digest_reused', 'this transaction already ran on chain', digest) : refuse('simulate_failed', `could not check the transaction: ${ran}`);
  }

  let executed: SuiClientTypes.TransactionResult<{ balanceChanges: true; events: true }>;
  try {
    executed = await client.core.executeTransaction({
      transaction: bytes,
      signatures: payment.signatures,
      include: { balanceChanges: true, events: true },
    });
  } catch (err) {
    await store.release(digest, expect.debtId);
    return refuse('execute_failed', errorMessage(err));
  }
  if (executed.$kind === 'FailedTransaction') {
    await store.release(digest, expect.debtId);
    return refuse('execute_failed', executionMessage(executed.FailedTransaction.status), executed.FailedTransaction.digest);
  }
  const settled = checkEffects(executed.Transaction, expect, via);
  if (settled) {
    await store.release(digest, expect.debtId);
    return { ...settled, digest: executed.Transaction.digest };
  }
  await store.confirm(digest, expect.debtId);
  return { ok: true, digest: executed.Transaction.digest, payer: sender, via };
}

/** true if the digest is already on chain, false if not found, or the lookup error. */
async function alreadyExecuted(client: ClientWithCoreApi, digest: string): Promise<boolean | string> {
  try {
    await client.core.getTransaction({ digest });
    return true;
  } catch (err) {
    const msg = errorMessage(err);
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    return code === 'NOT_FOUND' || /not.?found|could not find|does not exist/i.test(msg) ? false : msg;
  }
}

/** The earlier settlement of this debt or digest, if there was one. */
export async function priorSettlement(store: SettlementStore, digest: string, debtId: string): Promise<SettleRefusal | null> {
  const settledWith = await store.settledDigest(debtId);
  if (settledWith) return refuse('already_settled', undefined, settledWith);
  const usedFor = await store.settledDebt(digest);
  if (usedFor) return refuse('digest_reused', `digest already settled debt ${usedFor}`, digest);
  return null;
}

function isOnlySettleCall(data: ReturnType<Transaction['getData']>, pkg: string): boolean {
  if (data.commands.length !== 1) return false;
  const call = data.commands[0]?.MoveCall;
  return (
    !!call && normalizeSuiAddress(call.package) === normalizeSuiAddress(pkg) && call.module === 'settle' && call.function === 'settle'
  );
}

/** `null` when the effects settle the debt as expected, otherwise the reason they do not. */
export function checkEffects(effects: Effects, expect: PaymentExpectation, via: 'wallet' | 'agent'): SettleRefusal | null {
  const creditor = normalizeSuiAddress(expect.creditor);
  const coin = normalizeStructTag(expect.coinType);
  const received = effects.balanceChanges
    .filter((c) => normalizeSuiAddress(c.address) === creditor && normalizeStructTag(c.coinType) === coin)
    .reduce((sum, c) => sum + BigInt(c.amount), 0n);
  if (received <= 0n) return refuse('wrong_recipient', `creditor receives no ${coin}`);
  if (received !== expect.amount) return refuse('wrong_amount', `creditor receives ${received}, debt is ${expect.amount}`);

  if (via === 'agent') {
    const settledThis = effects.events.some((e) => {
      if (!isDebtSettled(e.eventType, expect.quitsPkg)) return false;
      const ev = DebtSettledBcs.parse(e.bcs);
      return (
        ev.reference === expect.debtId &&
        normalizeSuiAddress(ev.debtor) === normalizeSuiAddress(expect.debtor) &&
        normalizeSuiAddress(ev.creditor) === creditor &&
        BigInt(ev.amount) === expect.amount
      );
    });
    if (!settledThis) return refuse('wrong_debt', `transaction does not settle debt ${expect.debtId}`);
  }
  return null;
}

function isDebtSettled(eventType: string, pkg: string): boolean {
  const tag = parseStructTag(eventType);
  return normalizeSuiAddress(tag.address) === normalizeSuiAddress(pkg) && tag.module === 'settle' && tag.name === 'DebtSettled';
}

function executionMessage(status: SuiClientTypes.ExecutionStatus): string {
  return status.success ? 'unknown failure' : status.error.message;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
