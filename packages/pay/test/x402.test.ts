import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { USDC_MAINNET, sendFundsTx } from '@quits/chain';
import { Challenge } from 'mppx';
import { describe, expect, it, vi } from 'vitest';
import {
  PaymentHeaderError,
  createMemorySettlementStore,
  decodePaymentHeader,
  encodePaymentHeader,
  paymentFromHeaders,
  paymentRequired,
  settlementHeaders,
  verifyAndSettle,
  type X402PaymentPayload,
} from '../src/index.ts';

const debtor = '0x' + 'a'.repeat(64);
const creditor = '0x' + 'b'.repeat(64);
const agent = '0x' + 'c'.repeat(64);
const debt = { id: 'debt-42', debtor, creditor, usdcMicro: 12_340_000n };
const resource = 'https://quits.example/api/pay/debt-42';

function decodeJson(b64: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64(b64)));
}

describe('paymentRequired', () => {
  it('requirements_shape_matches_x402_v2_exact_sui', () => {
    const res = paymentRequired(debt, { resource, usdcType: USDC_MAINNET });

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: resource, description: 'Quits debt debt-42', mimeType: 'application/json' },
      accepts: [
        {
          scheme: 'exact',
          network: 'sui:mainnet',
          asset: USDC_MAINNET,
          amount: '12340000',
          payTo: creditor,
          maxTimeoutSeconds: 120,
          extra: { debtId: 'debt-42', debtor },
        },
      ],
    });
    expect(decodeJson(res.headers['PAYMENT-REQUIRED']!)).toEqual(res.body);
  });

  it('carries an MPP sui charge challenge on the same response', () => {
    const res = paymentRequired(debt, { resource, usdcType: USDC_MAINNET, mpp: { secretKey: 'test-secret' } });
    const header = res.headers['WWW-Authenticate']!;

    expect(header.startsWith('Payment ')).toBe(true);
    const challenge = Challenge.deserialize(header);
    expect(challenge).toMatchObject({
      method: 'sui',
      intent: 'charge',
      realm: 'quits.example',
      request: { amount: '12.34', currency: USDC_MAINNET, recipient: creditor },
    });
    expect(Challenge.verify(challenge, { secretKey: 'test-secret' })).toBe(true);
  });

  it('names the failure when it re-issues a 402', () => {
    const res = paymentRequired(debt, { resource, usdcType: USDC_MAINNET, network: 'localnet', error: 'wrong_amount' });
    expect(res.body.error).toBe('wrong_amount');
    expect(res.body.accepts[0]!.network).toBe('sui:localnet');
  });
});

describe('payment headers', () => {
  const payload: X402PaymentPayload = {
    x402Version: 2,
    payload: { signature: 'c2ln', transaction: 'dHg=' },
  };

  it('round-trips a payment payload', () => {
    expect(decodePaymentHeader(encodePaymentHeader(payload))).toEqual(payload);
  });

  it('reads PAYMENT-SIGNATURE and falls back to the legacy X-PAYMENT header', () => {
    const value = encodePaymentHeader(payload);
    expect(paymentFromHeaders(new Headers({ 'payment-signature': value }))).toEqual({ txBytesB64: 'dHg=', signatures: ['c2ln'] });
    expect(paymentFromHeaders({ 'X-PAYMENT': value })).toEqual({ txBytesB64: 'dHg=', signatures: ['c2ln'] });
    expect(paymentFromHeaders(new Headers())).toBeNull();
  });

  it('keeps every signature of a sponsored payment', () => {
    const value = encodePaymentHeader({ x402Version: 2, payload: { signature: 'a', signatures: ['a', 'b'], transaction: 'dHg=' } });
    expect(paymentFromHeaders({ 'payment-signature': value })).toEqual({ txBytesB64: 'dHg=', signatures: ['a', 'b'] });
  });

  it.each([
    ['not base64 json', '%%%'],
    ['missing transaction', toBase64(new TextEncoder().encode(JSON.stringify({ x402Version: 2, payload: { signature: 'a' } })))],
    [
      'another scheme',
      encodePaymentHeader({
        x402Version: 2,
        accepted: { scheme: 'upto', network: 'sui:mainnet' } as never,
        payload: { signature: 'a', transaction: 'dHg=' },
      }),
    ],
  ])('rejects a malformed header (%s)', (_label, value) => {
    expect(() => paymentFromHeaders({ 'payment-signature': value })).toThrow(PaymentHeaderError);
  });

  it('encodes the settlement response', () => {
    const headers = settlementHeaders({ digest: 'D1G', payer: debtor }, 'sui:mainnet');
    expect(decodeJson(headers['PAYMENT-RESPONSE']!)).toEqual({ success: true, transaction: 'D1G', network: 'sui:mainnet', payer: debtor });
  });
});

describe('verifyAndSettle without a network', () => {
  const expect_ = { debtId: debt.id, debtor, creditor, amount: debt.usdcMicro, agent, quitsPkg: '0x' + 'd'.repeat(64), coinType: USDC_MAINNET };

  function offlineClient() {
    const fail = vi.fn(() => {
      throw new Error('no network in this test');
    });
    return { client: { core: { simulateTransaction: fail, executeTransaction: fail } } as never, fail };
  }

  async function signedTransfer(signer: Ed25519Keypair, to: string, amount: bigint) {
    const tx = sendFundsTx({ to, amount, coinType: USDC_MAINNET });
    tx.setSender(signer.toSuiAddress());
    tx.setGasPrice(0);
    tx.setGasBudget(0);
    tx.setGasPayment([]);
    tx.setExpiration({ None: true });
    const bytes = await tx.build();
    const { signature } = await signer.signTransaction(bytes);
    return { txBytesB64: toBase64(bytes), signatures: [signature] };
  }

  it('rejects undecodable bytes', async () => {
    const { client, fail } = offlineClient();
    const res = await verifyAndSettle(client, { txBytesB64: 'AAAA', signatures: ['x'] }, expect_, { store: createMemorySettlementStore() });
    expect(res).toMatchObject({ ok: false, reason: 'malformed' });
    expect(fail).not.toHaveBeenCalled();
  });

  it('rejects a payer who is neither the debtor nor the agent', async () => {
    const { client, fail } = offlineClient();
    const stranger = Ed25519Keypair.generate();
    const payment = await signedTransfer(stranger, creditor, debt.usdcMicro);
    const res = await verifyAndSettle(client, payment, expect_, { store: createMemorySettlementStore() });
    expect(res).toMatchObject({ ok: false, reason: 'bad_sender' });
    expect(fail).not.toHaveBeenCalled();
  });

  it('rejects a signature that is not the sender’s', async () => {
    const { client, fail } = offlineClient();
    const ana = Ed25519Keypair.generate();
    const payment = await signedTransfer(ana, creditor, debt.usdcMicro);
    const forged = await signedTransfer(Ed25519Keypair.generate(), creditor, debt.usdcMicro);
    const res = await verifyAndSettle(
      client,
      { txBytesB64: payment.txBytesB64, signatures: forged.signatures },
      { ...expect_, debtor: ana.toSuiAddress() },
      { store: createMemorySettlementStore() },
    );
    expect(res).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(fail).not.toHaveBeenCalled();
  });

  it('returns the first receipt for a debt that is already settled, without touching the chain', async () => {
    const { client, fail } = offlineClient();
    const store = createMemorySettlementStore();
    await store.claim('FIRST', debt.id);
    await store.confirm('FIRST', debt.id);
    const ana = Ed25519Keypair.generate();
    const payment = await signedTransfer(ana, creditor, debt.usdcMicro);
    const res = await verifyAndSettle(client, payment, { ...expect_, debtor: ana.toSuiAddress() }, { store });
    expect(res).toEqual({ ok: false, reason: 'already_settled', digest: 'FIRST' });
    expect(fail).not.toHaveBeenCalled();
  });

  it('does not execute while another settlement of the debt is running', async () => {
    const ana = Ed25519Keypair.generate();
    const store = createMemorySettlementStore();
    await store.claim('RUNNING', debt.id);
    const executeTransaction = vi.fn();
    const client = {
      core: {
        simulateTransaction: async () => ({
          $kind: 'Transaction',
          Transaction: { balanceChanges: [{ address: creditor, coinType: USDC_MAINNET, amount: debt.usdcMicro.toString() }], events: [] },
        }),
        executeTransaction,
      },
    } as never;

    const payment = await signedTransfer(ana, creditor, debt.usdcMicro);
    const res = await verifyAndSettle(client, payment, { ...expect_, debtor: ana.toSuiAddress() }, { store });

    expect(res).toMatchObject({ ok: false, reason: 'in_progress' });
    expect(executeTransaction).not.toHaveBeenCalled();
  });
});

describe('settlement store', () => {
  it('reserves a digest for one debt only and remembers it once confirmed', async () => {
    const store = createMemorySettlementStore();
    expect(await store.claim('D1', 'debt-1')).toBe(true);
    expect(await store.claim('D1', 'debt-2')).toBe(false);
    expect(await store.claim('D2', 'debt-1')).toBe(false);
    expect(await store.settledDigest('debt-1')).toBeNull();

    await store.confirm('D1', 'debt-1');
    expect(await store.settledDigest('debt-1')).toBe('D1');
    expect(await store.settledDebt('D1')).toBe('debt-1');

    await store.release('D1', 'debt-1');
    expect(await store.settledDigest('debt-1')).toBe('D1');
  });

  it('frees a reservation that did not settle', async () => {
    const store = createMemorySettlementStore();
    await store.claim('D1', 'debt-1');
    await store.release('D1', 'debt-1');
    expect(await store.claim('D2', 'debt-1')).toBe(true);
    await expect(store.confirm('D1', 'debt-1')).rejects.toThrow();
  });
});
