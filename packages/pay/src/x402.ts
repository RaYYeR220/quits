import { fromBase64, toBase64 } from '@mysten/sui/utils';
import type { Micro } from '@quits/core';
import { mppChallenge, type MppOptions } from './mpp.ts';
import type { SuiPayment } from './verify.ts';

export const X402_VERSION = 2;
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
/** x402 v1 request header, still sent by older clients. */
export const LEGACY_PAYMENT_HEADER = 'X-PAYMENT';

export type SuiNetworkName = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
export type SuiX402Network = `sui:${SuiNetworkName}`;

export interface PayableDebt {
  id: string;
  debtor: string;
  creditor: string;
  usdcMicro: Micro;
}

/** One `accepts[]` entry of the x402 `exact` scheme on Sui. */
export interface ExactSuiRequirements {
  scheme: 'exact';
  network: SuiX402Network;
  /** Coin type of the payment asset. */
  asset: string;
  /** Atomic units, as a decimal string. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { debtId: string; debtor: string };
}

/** x402 v2 `PaymentRequired` body. */
export interface X402Requirements {
  x402Version: typeof X402_VERSION;
  error: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: ExactSuiRequirements[];
}

/** x402 v2 `PaymentPayload` for `exact` on Sui: the signed transaction, not yet executed. */
export interface X402PaymentPayload {
  x402Version: number;
  resource?: X402Requirements['resource'];
  accepted?: ExactSuiRequirements;
  payload: {
    signature: string;
    /** Base64 BCS `TransactionData`. */
    transaction: string;
    /** All signatures when there is more than one (sponsored transactions). */
    signatures?: string[];
  };
}

export interface X402SettleResponse {
  success: boolean;
  transaction: string;
  network: SuiX402Network;
  payer?: string;
}

export class PaymentHeaderError extends Error {
  override name = 'PaymentHeaderError';
}

export interface PaymentRequiredOptions {
  /** Absolute URL of the paid resource. */
  resource: string;
  /** Coin type to pay in (mainnet USDC; SUI on localnet). */
  usdcType: string;
  network?: SuiNetworkName;
  /** Why an earlier payment was refused, when re-issuing the 402. */
  error?: string;
  maxTimeoutSeconds?: number;
  mpp?: MppOptions;
}

/** The 402 for an open debt: x402 v2 body and header, plus an MPP challenge. */
export function paymentRequired(
  debt: PayableDebt,
  o: PaymentRequiredOptions,
): { status: 402; body: X402Requirements; headers: Record<string, string> } {
  if (debt.usdcMicro <= 0n) throw new RangeError(`Debt ${debt.id} has nothing to pay`);
  const body: X402Requirements = {
    x402Version: X402_VERSION,
    error: o.error ?? 'Payment required',
    resource: { url: o.resource, description: `Quits debt ${debt.id}`, mimeType: 'application/json' },
    accepts: [
      {
        scheme: 'exact',
        network: `sui:${o.network ?? 'mainnet'}`,
        asset: o.usdcType,
        amount: debt.usdcMicro.toString(),
        payTo: debt.creditor,
        maxTimeoutSeconds: o.maxTimeoutSeconds ?? 120,
        extra: { debtId: debt.id, debtor: debt.debtor },
      },
    ],
  };
  return {
    status: 402,
    body,
    headers: {
      [PAYMENT_REQUIRED_HEADER]: encodeJson(body),
      'WWW-Authenticate': mppChallenge(debt, { resource: o.resource, usdcType: o.usdcType, ...o.mpp }),
    },
  };
}

/** The first `exact` Sui option of a 402 body. */
export function exactSuiOption(req: X402Requirements): ExactSuiRequirements {
  const option = req.accepts.find((a) => a.scheme === 'exact' && a.network.startsWith('sui:'));
  if (!option) throw new PaymentHeaderError('The payment requirements offer no exact Sui option');
  return option;
}

export function encodePaymentHeader(payment: X402PaymentPayload): string {
  return encodeJson(payment);
}

/**
 * Parses a `PAYMENT-SIGNATURE` / `X-PAYMENT` value. Also understands the
 * `@suimpp/mpp/x402` payload (`txBytes`, `senderSignature`).
 */
export function decodePaymentHeader(value: string): X402PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64(value.trim())));
  } catch (err) {
    throw new PaymentHeaderError('Payment header is not base64-encoded JSON', { cause: err });
  }
  if (!isRecord(parsed) || !isRecord(parsed.payload)) throw new PaymentHeaderError('Payment header has no payload');

  const accepted = isRecord(parsed.accepted) ? parsed.accepted : undefined;
  const scheme = accepted?.scheme ?? parsed.scheme;
  const network = accepted?.network ?? parsed.network;
  if (scheme !== undefined && scheme !== 'exact') throw new PaymentHeaderError(`Unsupported scheme: ${String(scheme)}`);
  if (network !== undefined && !(typeof network === 'string' && network.startsWith('sui:'))) {
    throw new PaymentHeaderError(`Unsupported network: ${String(network)}`);
  }

  const p = parsed.payload;
  const transaction = p.transaction ?? p.txBytes;
  const signature = p.signature ?? p.senderSignature;
  const signatures = Array.isArray(p.signatures) ? p.signatures : [signature];
  if (typeof transaction !== 'string' || transaction === '') throw new PaymentHeaderError('Payment payload has no transaction');
  if (signatures.length === 0 || !signatures.every((s): s is string => typeof s === 'string' && s !== '')) {
    throw new PaymentHeaderError('Payment payload has no signature');
  }

  return {
    x402Version: typeof parsed.x402Version === 'number' ? parsed.x402Version : X402_VERSION,
    ...(isRecord(parsed.resource) ? { resource: parsed.resource as X402PaymentPayload['resource'] } : {}),
    ...(accepted ? { accepted: accepted as unknown as ExactSuiRequirements } : {}),
    payload: {
      signature: signatures[0]!,
      transaction,
      ...(Array.isArray(p.signatures) ? { signatures } : {}),
    },
  };
}

export function toSuiPayment(payment: X402PaymentPayload): SuiPayment {
  return { txBytesB64: payment.payload.transaction, signatures: payment.payload.signatures ?? [payment.payload.signature] };
}

/** Reads the payment from request headers; `null` when the client sent none. */
export function paymentFromHeaders(headers: Headers | Record<string, string | string[] | undefined>): SuiPayment | null {
  const value = headerValue(headers, PAYMENT_SIGNATURE_HEADER) ?? headerValue(headers, LEGACY_PAYMENT_HEADER);
  return value === null ? null : toSuiPayment(decodePaymentHeader(value));
}

/** `PAYMENT-RESPONSE` header for a settled payment (or the receipt of an earlier one). */
export function settlementHeaders(settled: { digest: string; payer?: string }, network: SuiX402Network): Record<string, string> {
  const response: X402SettleResponse = {
    success: true,
    transaction: settled.digest,
    network,
    ...(settled.payer ? { payer: settled.payer } : {}),
  };
  return { [PAYMENT_RESPONSE_HEADER]: encodeJson(response) };
}

function headerValue(headers: Headers | Record<string, string | string[] | undefined>, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : headers[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function encodeJson(value: unknown): string {
  return toBase64(new TextEncoder().encode(JSON.stringify(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
