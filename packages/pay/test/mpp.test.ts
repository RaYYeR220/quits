import { suiCharge } from '@suimpp/mpp';
import { USDC_MAINNET } from '@quits/chain';
import { Challenge, Credential, Receipt } from 'mppx';
import { describe, expect, it, vi } from 'vitest';
import { createMemorySettlementStore, mppReceiptHeaders, paymentRequired, verifyMppPayment } from '../src/index.ts';

const debtor = '0x' + 'a'.repeat(64);
const creditor = '0x' + 'b'.repeat(64);
const debt = { id: 'debt-7', debtor, creditor, usdcMicro: 2_500_000n };
const resource = 'https://quits.example/api/pay/debt-7';
const expectation = {
  debtId: debt.id,
  debtor,
  creditor,
  amount: debt.usdcMicro,
  agent: '0x' + 'c'.repeat(64),
  quitsPkg: '0x' + 'd'.repeat(64),
  coinType: USDC_MAINNET,
};

function offlineClient() {
  const getTransaction = vi.fn(() => {
    throw new Error('no network in this test');
  });
  return { client: { core: { getTransaction } } as never, getTransaction };
}

function credentialFor(wwwAuthenticate: string, payload = { digest: 'D1G', signature: 'c2ln' }) {
  return Credential.serialize({ challenge: Challenge.deserialize(wwwAuthenticate), payload });
}

describe('verifyMppPayment without a network', () => {
  it('rejects an Authorization header without a Payment credential', async () => {
    const { client, getTransaction } = offlineClient();
    for (const header of ['Bearer abc', 'Payment !!!']) {
      const res = await verifyMppPayment(client, header, expectation, { store: createMemorySettlementStore() });
      expect(res).toMatchObject({ ok: false, reason: 'malformed' });
    }
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it('rejects a challenge that was issued for another debt', async () => {
    const { client, getTransaction } = offlineClient();
    const other = paymentRequired({ ...debt, id: 'debt-8' }, { resource, usdcType: USDC_MAINNET, mpp: { secretKey: 'k' } });
    const res = await verifyMppPayment(client, credentialFor(other.headers['WWW-Authenticate']!), expectation, {
      store: createMemorySettlementStore(),
      secretKey: 'k',
    });
    expect(res).toMatchObject({ ok: false, reason: 'wrong_debt' });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it('rejects a challenge whose terms were edited by the client', async () => {
    const { client } = offlineClient();
    const issued = Challenge.deserialize(paymentRequired(debt, { resource, usdcType: USDC_MAINNET, mpp: { secretKey: 'k' } }).headers['WWW-Authenticate']!);
    const cheaper = Credential.serialize({
      challenge: { ...issued, request: { ...issued.request, amount: '0.01' } },
      payload: { digest: 'D1G', signature: 'c2ln' },
    });
    const res = await verifyMppPayment(client, cheaper, expectation, { store: createMemorySettlementStore(), secretKey: 'k' });
    expect(res).toMatchObject({ ok: false, reason: 'wrong_debt' });
  });

  it('rejects an unbound challenge whose amount differs from the debt', async () => {
    const { client } = offlineClient();
    const forged = Challenge.fromMethod(suiCharge, {
      id: `quits-${debt.id}-${debt.usdcMicro}`,
      realm: 'quits.example',
      meta: { debtId: debt.id },
      request: { amount: '0.01', currency: USDC_MAINNET, recipient: creditor },
    });
    const header = Credential.serialize({ challenge: forged, payload: { digest: 'D1G', signature: 'c2ln' } });
    const res = await verifyMppPayment(client, header, expectation, { store: createMemorySettlementStore() });
    expect(res).toMatchObject({ ok: false, reason: 'wrong_amount' });
  });

  it('returns the first receipt for a settled debt without a chain lookup', async () => {
    const { client, getTransaction } = offlineClient();
    const store = createMemorySettlementStore();
    await store.claim('FIRST', debt.id);
    await store.confirm('FIRST', debt.id);
    const header = credentialFor(paymentRequired(debt, { resource, usdcType: USDC_MAINNET }).headers['WWW-Authenticate']!);
    expect(await verifyMppPayment(client, header, expectation, { store })).toEqual({ ok: false, reason: 'already_settled', digest: 'FIRST' });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it('builds a Payment-Receipt header', () => {
    const receipt = Receipt.deserialize(mppReceiptHeaders({ digest: 'D1G' })['Payment-Receipt']!);
    expect(receipt).toMatchObject({ method: 'sui', reference: 'D1G', status: 'success' });
  });
});
