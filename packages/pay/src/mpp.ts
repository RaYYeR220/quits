import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { isValidPersonalMessageSignature } from '@mysten/sui/verify';
import { suiCharge } from '@suimpp/mpp';
import { Challenge, Credential, Receipt } from 'mppx';
import {
  checkEffects,
  errorMessage,
  priorSettlement,
  refuse,
  type PaymentExpectation,
  type SettleResult,
} from './verify.ts';
import type { SettlementStore } from './store.ts';
import type { PayableDebt } from './x402.ts';

export interface MppOptions {
  /** Server realm; defaults to the resource's host. */
  realm?: string;
  /** HMAC key binding the challenge id to its terms. Without it the id is derived from the debt. */
  secretKey?: string;
  /** Decimals of the asset; MPP sui charges are quoted in whole units (USDC: 6). */
  decimals?: number;
}

/**
 * `WWW-Authenticate: Payment …` challenge for the `sui` MPP method (`@suimpp/mpp`),
 * so MPP clients can pay the same debt the x402 body describes.
 */
export function mppChallenge(debt: PayableDebt, o: MppOptions & { resource: string; usdcType: string }): string {
  const base = {
    realm: o.realm ?? new URL(o.resource).host,
    description: `Quits debt ${debt.id}`,
    meta: { debtId: debt.id },
    request: { amount: toDecimal(debt.usdcMicro, o.decimals ?? 6), currency: o.usdcType, recipient: debt.creditor },
  };
  const challenge = o.secretKey
    ? Challenge.fromMethod(suiCharge, { ...base, secretKey: o.secretKey })
    : Challenge.fromMethod(suiCharge, { ...base, id: unboundChallengeId(debt.id, debt.usdcMicro) });
  return Challenge.serialize(challenge);
}

/**
 * Redeems an MPP `Authorization: Payment …` credential from a `@suimpp/mpp`
 * client. The client already executed the transfer, so nothing is submitted:
 * the challenge must be ours and for this debt, the on-chain transaction must
 * come from the debtor and pay the creditor exactly, and the proof signature
 * must be the sender's. Replays return `already_settled` with the first digest.
 */
export async function verifyMppPayment(
  client: ClientWithCoreApi,
  authorization: string,
  expect: PaymentExpectation,
  {
    store,
    secretKey,
    decimals = 6,
    lookupTimeoutMs = 10_000,
  }: { store: SettlementStore; secretKey?: string; decimals?: number; lookupTimeoutMs?: number },
): Promise<SettleResult> {
  const scheme = Credential.extractPaymentScheme(authorization);
  if (!scheme) return refuse('malformed', 'no Payment credential');
  let credential: Credential.Credential<{ digest?: unknown; signature?: unknown }>;
  try {
    credential = Credential.deserialize(scheme);
  } catch (err) {
    return refuse('malformed', errorMessage(err));
  }
  const { challenge, payload } = credential;
  const { digest, signature } = payload ?? {};
  if (challenge.method !== 'sui' || challenge.intent !== 'charge' || typeof digest !== 'string' || typeof signature !== 'string') {
    return refuse('malformed', 'not a sui charge credential');
  }

  const replay = await priorSettlement(store, digest, expect.debtId);
  if (replay) return replay;

  const bound = secretKey ? Challenge.verify(challenge, { secretKey }) : challenge.id === unboundChallengeId(expect.debtId, expect.amount);
  if (!bound || challenge.opaque?.debtId !== expect.debtId) return refuse('wrong_debt', 'challenge was not issued for this debt');
  const request = challenge.request as { amount?: unknown; currency?: unknown; recipient?: unknown };
  if (typeof request.currency !== 'string' || normalizeStructTag(request.currency) !== normalizeStructTag(expect.coinType)) {
    return refuse('wrong_debt', `challenge asks for ${String(request.currency)}`);
  }
  if (typeof request.recipient !== 'string' || normalizeSuiAddress(request.recipient) !== normalizeSuiAddress(expect.creditor)) {
    return refuse('wrong_recipient', 'challenge pays someone other than the creditor');
  }
  if (typeof request.amount !== 'string' || parseDecimal(request.amount, decimals) !== expect.amount) {
    return refuse('wrong_amount', `challenge asks for ${String(request.amount)}`);
  }

  let tx: SuiClientTypes.TransactionResult<{ balanceChanges: true; events: true; transaction: true }>;
  try {
    // MPP clients present the credential right after executing, often before the digest is indexed.
    tx = await client.core.waitForTransaction({
      digest,
      include: { balanceChanges: true, events: true, transaction: true },
      timeout: lookupTimeoutMs,
    });
  } catch (err) {
    return refuse('execute_failed', `payment transaction not found: ${errorMessage(err)}`, digest);
  }
  if (tx.$kind === 'FailedTransaction') return refuse('execute_failed', 'payment transaction failed on-chain', digest);

  const sender = normalizeSuiAddress(tx.Transaction.transaction.sender ?? '');
  if (sender !== normalizeSuiAddress(expect.debtor)) return refuse('bad_sender', `paid by ${sender}, not the debtor`, digest);
  const effects = checkEffects(tx.Transaction, expect, 'wallet');
  if (effects) return { ...effects, digest };

  let proven: boolean;
  try {
    proven = await isValidPersonalMessageSignature(proofMessage(challenge, digest), signature, { address: sender, client });
  } catch (err) {
    return refuse('bad_signature', `proof could not be checked: ${errorMessage(err)}`, digest);
  }
  if (!proven) return refuse('bad_signature', 'payment proof is not signed by the sender', digest);

  if (!(await store.claim(digest, expect.debtId))) {
    return (await priorSettlement(store, digest, expect.debtId)) ?? refuse('in_progress', 'this debt is being settled right now');
  }
  await store.confirm(digest, expect.debtId);
  return { ok: true, digest, payer: sender, via: 'wallet' };
}

/** `Payment-Receipt` header for a settled MPP payment. */
export function mppReceiptHeaders({ digest }: { digest: string }): Record<string, string> {
  const receipt = Receipt.from({ method: 'sui', reference: digest, status: 'success', timestamp: new Date().toISOString() });
  return { 'Payment-Receipt': Receipt.serialize(receipt) };
}

function unboundChallengeId(debtId: string, amount: bigint): string {
  return `quits-${debtId}-${amount}`;
}

/** The message `@suimpp/mpp` clients sign to bind a digest to a challenge. */
function proofMessage(challenge: Challenge.Challenge, digest: string): Uint8Array {
  const request = challenge.request as { amount: unknown; currency: unknown; recipient: unknown };
  return new TextEncoder().encode(
    JSON.stringify({
      domain: 'suimpp.sui.payment-proof',
      version: 1,
      method: challenge.method,
      intent: challenge.intent,
      challengeId: challenge.id,
      amount: request.amount,
      currency: request.currency,
      recipient: request.recipient,
      digest,
    }),
  );
}

function toDecimal(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const frac = (raw % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${raw / unit}.${frac}` : `${raw / unit}`;
}

function parseDecimal(amount: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!m || (m[2]?.length ?? 0) > decimals) return null;
  return BigInt(m[1]! + (m[2] ?? '').padEnd(decimals, '0'));
}
