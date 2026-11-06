import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { toBase64 } from '@mysten/sui/utils';
import { SUI_TYPE, readDebt, sendFundsTx, signAndExecute } from '@quits/chain';
import {
  depositToAddressBalance,
  openLocalMandate,
  recordLocalDebt,
  startLocalQuits,
  totalBalance,
  type LocalQuits,
} from '@quits/chain/testing';
import { suiCharge, suiClient } from '@suimpp/mpp';
import { Challenge } from 'mppx';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildAgentPayment,
  buildWalletPayment,
  createMemorySettlementStore,
  paymentFromHeaders,
  paymentRequired,
  verifyAndSettle,
  verifyMppPayment,
  type PaymentExpectation,
  type SuiPayment,
} from '../src/index.ts';

describe.skipIf(!process.env.LOCALNET)('x402 exact settlement on localnet', () => {
  let q: LocalQuits;
  let ana: string;
  let ben: string;
  let seq = 0;

  beforeAll(async () => {
    q = await startLocalQuits();
    ana = q.ana.toSuiAddress();
    ben = q.ben.toSuiAddress();
  }, 180_000);

  function newDebt(usdcMicro: bigint) {
    return { id: `debt-${Date.now()}-${seq++}`, debtor: ana, creditor: ben, usdcMicro };
  }

  function expectationFor(debt: ReturnType<typeof newDebt>): PaymentExpectation {
    return {
      debtId: debt.id,
      debtor: debt.debtor,
      creditor: debt.creditor,
      amount: debt.usdcMicro,
      agent: q.agent.toSuiAddress(),
      quitsPkg: q.cfg.pkg,
      coinType: SUI_TYPE,
    };
  }

  function requirementsFor(debt: ReturnType<typeof newDebt>) {
    return paymentRequired(debt, { resource: `http://localhost/api/pay/${debt.id}`, usdcType: SUI_TYPE, network: 'localnet' }).body;
  }

  async function signedTransfer(signer: Ed25519Keypair, to: string, amount: bigint): Promise<SuiPayment> {
    const tx = sendFundsTx({ to, amount, coinType: SUI_TYPE });
    tx.setSender(signer.toSuiAddress());
    const bytes = await tx.build({ client: q.client });
    const { signature } = await signer.signTransaction(bytes);
    return { txBytesB64: toBase64(bytes), signatures: [signature] };
  }

  it('wallet_payment_settles', async () => {
    const debt = newDebt(25_000_000n);
    const header = await buildWalletPayment(q.ana, requirementsFor(debt), { client: q.client });
    const payment = paymentFromHeaders({ 'PAYMENT-SIGNATURE': header })!;

    const before = await totalBalance(q.client, ben);
    const res = await verifyAndSettle(q.client, payment, expectationFor(debt), { store: createMemorySettlementStore() });

    expect(res).toMatchObject({ ok: true, payer: ana, via: 'wallet' });
    await q.client.core.waitForTransaction({ digest: (res as { digest: string }).digest });
    expect((await totalBalance(q.client, ben)) - before).toBe(debt.usdcMicro);
  });

  it('refuses a signed transfer that already ran on chain, even for a fresh debt', async () => {
    const paid = newDebt(12_000_000n);
    const header = await buildWalletPayment(q.ana, requirementsFor(paid), { client: q.client });
    const payment = paymentFromHeaders({ 'PAYMENT-SIGNATURE': header })!;
    const first = await verifyAndSettle(q.client, payment, expectationFor(paid), { store: createMemorySettlementStore() });
    expect(first).toMatchObject({ ok: true });
    await q.client.core.waitForTransaction({ digest: (first as { digest: string }).digest });

    // same debtor, creditor and amount, a store that has never seen the digest: the public signed bytes are replayed
    const twin = newDebt(12_000_000n);
    const replay = await verifyAndSettle(q.client, payment, expectationFor(twin), { store: createMemorySettlementStore() });
    expect(replay).toMatchObject({ ok: false });
    expect((replay as { reason: string }).reason).toMatch(/digest_reused|simulate_failed/);
  });

  it('agent_allowance_payment_settles', async () => {
    const debt = newDebt(40_000_000n);
    const { mandateId, allowanceId } = await openLocalMandate(q, q.ana, { creditors: [ben], maxPerDebt: 1_000_000_000n });
    const debtId = await recordLocalDebt(q, { mandateId, reference: debt.id, creditor: ben, amount: debt.usdcMicro });

    const header = await buildAgentPayment(
      q.agent,
      q.cfg,
      { mandateId, debtId, allowanceId, funder: ana, amount: debt.usdcMicro },
      { client: q.client, requirements: requirementsFor(debt) },
    );
    const before = await totalBalance(q.client, ben);
    const res = await verifyAndSettle(q.client, paymentFromHeaders({ 'x-payment': header })!, expectationFor(debt), {
      store: createMemorySettlementStore(),
    });

    expect(res).toMatchObject({ ok: true, payer: q.agent.toSuiAddress(), via: 'agent' });
    await q.client.core.waitForTransaction({ digest: (res as { digest: string }).digest });
    expect((await totalBalance(q.client, ben)) - before).toBe(debt.usdcMicro);
    expect((await readDebt(q.client, debtId, q.cfg)).status).toBe('settled_allowance');
  });

  it('rejects an agent transaction that settles a different debt', async () => {
    const debt = newDebt(30_000_000n);
    const other = newDebt(30_000_000n);
    const { mandateId, allowanceId } = await openLocalMandate(q, q.ana, { creditors: [ben], maxPerDebt: 1_000_000_000n });
    const otherId = await recordLocalDebt(q, { mandateId, reference: other.id, creditor: ben, amount: other.usdcMicro });

    const header = await buildAgentPayment(
      q.agent,
      q.cfg,
      { mandateId, debtId: otherId, allowanceId, funder: ana, amount: other.usdcMicro },
      { client: q.client },
    );
    const exec = vi.spyOn(q.client.core, 'executeTransaction');
    const res = await verifyAndSettle(q.client, paymentFromHeaders({ 'x-payment': header })!, expectationFor(debt), {
      store: createMemorySettlementStore(),
    });

    expect(res).toMatchObject({ ok: false, reason: 'wrong_debt' });
    expect(exec).not.toHaveBeenCalled();
    exec.mockRestore();
    expect((await readDebt(q.client, otherId, q.cfg)).status).toBe('open');
  });

  it('wrong_amount_rejected_without_execution', async () => {
    const debt = newDebt(25_000_000n);
    const payment = await signedTransfer(q.ana, ben, debt.usdcMicro - 1n);
    const exec = vi.spyOn(q.client.core, 'executeTransaction');
    const before = await totalBalance(q.client, ben);

    const res = await verifyAndSettle(q.client, payment, expectationFor(debt), { store: createMemorySettlementStore() });

    expect(res).toMatchObject({ ok: false, reason: 'wrong_amount' });
    expect(exec).not.toHaveBeenCalled();
    exec.mockRestore();
    expect(await totalBalance(q.client, ben)).toBe(before);
  });

  it('wrong_recipient_rejected', async () => {
    const debt = newDebt(25_000_000n);
    const payment = await signedTransfer(q.ana, q.operator.toSuiAddress(), debt.usdcMicro);
    const exec = vi.spyOn(q.client.core, 'executeTransaction');

    const res = await verifyAndSettle(q.client, payment, expectationFor(debt), { store: createMemorySettlementStore() });

    expect(res).toMatchObject({ ok: false, reason: 'wrong_recipient' });
    expect(exec).not.toHaveBeenCalled();
    exec.mockRestore();
  });

  it('rejects a payment whose funds are gone by settlement time', async () => {
    const debt = newDebt(25_000_000n);
    const payment = await signedTransfer(q.ana, ben, debt.usdcMicro);

    const { balance } = await q.client.core.getBalance({ owner: ana });
    await signAndExecute(q.client, q.ana, sendFundsTx({ to: q.operator.toSuiAddress(), amount: BigInt(balance.addressBalance), coinType: SUI_TYPE }));
    const exec = vi.spyOn(q.client.core, 'executeTransaction');

    const res = await verifyAndSettle(q.client, payment, expectationFor(debt), { store: createMemorySettlementStore() });

    expect(res).toMatchObject({ ok: false, reason: 'simulate_failed' });
    expect(exec).not.toHaveBeenCalled();
    exec.mockRestore();
    await depositToAddressBalance(q.client, q.ana, 5_000_000_000n);
  });

  it('redeems a credential from the @suimpp/mpp client', async () => {
    const debt = newDebt(20_000_000n);
    const store = createMemorySettlementStore();
    const { headers } = paymentRequired(debt, {
      resource: `http://localhost/api/pay/${debt.id}`,
      usdcType: SUI_TYPE,
      network: 'localnet',
      mpp: { secretKey: 'local-secret', decimals: 9 },
    });
    const challenge = Challenge.deserialize(headers['WWW-Authenticate']!, { methods: [suiCharge] });
    const payer = suiClient({ client: q.client, signer: q.ana, currency: { type: SUI_TYPE, decimals: 9 } });
    const before = await totalBalance(q.client, ben);

    const authorization = await payer.createCredential({ challenge });
    const opts = { store, secretKey: 'local-secret', decimals: 9 };
    const res = await verifyMppPayment(q.client, authorization, expectationFor(debt), opts);

    expect(res).toMatchObject({ ok: true, payer: ana, via: 'wallet' });
    expect((await totalBalance(q.client, ben)) - before).toBe(debt.usdcMicro);
    const digest = (res as { digest: string }).digest;
    expect(await verifyMppPayment(q.client, authorization, expectationFor(debt), opts)).toEqual({
      ok: false,
      reason: 'already_settled',
      digest,
    });
  });

  it('replayed_digest_returns_already_settled', async () => {
    const debt = newDebt(15_000_000n);
    const store = createMemorySettlementStore();
    const payment = paymentFromHeaders({
      'payment-signature': await buildWalletPayment(q.ana, requirementsFor(debt), { client: q.client }),
    })!;

    const first = await verifyAndSettle(q.client, payment, expectationFor(debt), { store });
    expect(first.ok).toBe(true);
    const digest = (first as { digest: string }).digest;
    await q.client.core.waitForTransaction({ digest });
    const afterFirst = await totalBalance(q.client, ben);

    const exec = vi.spyOn(q.client.core, 'executeTransaction');
    const replay = await verifyAndSettle(q.client, payment, expectationFor(debt), { store });
    expect(replay).toEqual({ ok: false, reason: 'already_settled', digest });

    const late = await signedTransfer(q.ana, ben, debt.usdcMicro);
    const second = await verifyAndSettle(q.client, late, expectationFor(debt), { store });
    expect(second).toEqual({ ok: false, reason: 'already_settled', digest });

    const reused = await verifyAndSettle(q.client, payment, { ...expectationFor(debt), debtId: 'some-other-debt' }, { store });
    expect(reused).toMatchObject({ ok: false, reason: 'digest_reused', digest });

    expect(exec).not.toHaveBeenCalled();
    exec.mockRestore();
    expect(await totalBalance(q.client, ben)).toBe(afterFirst);
  });
});
