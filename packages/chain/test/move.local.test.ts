import { normalizeStructTag } from '@mysten/sui/utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { SUI_TYPE } from '../src/config.ts';
import { cancelDebtTx, markExternalTx, readAllowance, readDebt, readMandate, settleTx } from '../src/move.ts';
import { ChainTxError, signAndExecute } from '../src/tx.ts';
import { openLocalMandate, recordLocalDebt, startLocalQuits, totalBalance, type LocalQuits } from '../src/testing.ts';

describe.skipIf(!process.env.LOCALNET)('quits::settle on localnet', () => {
  let q: LocalQuits;
  let ana: string;
  let ben: string;

  beforeAll(async () => {
    q = await startLocalQuits();
    ana = q.ana.toSuiAddress();
    ben = q.ben.toSuiAddress();
  }, 180_000);

  it('open_record_settle_roundtrip_with_SUI', async () => {
    const { mandateId, allowanceId } = await openLocalMandate(q, q.ana, {
      creditors: [ben],
      maxPerDebt: 1_500_000_000n,
      lifetimeCap: 3_000_000_000n,
      weeklyLimit: 2_000_000_000n,
    });
    expect(await readMandate(q.client, mandateId, q.cfg)).toEqual({
      id: mandateId,
      funder: ana,
      group: 'flat-5b',
      creditors: [ben],
      maxPerDebt: 1_500_000_000n,
      objectionWindowMs: 0,
    });

    const amount = 1_234_000_000n;
    const debtId = await recordLocalDebt(q, { mandateId, reference: 'debt-001', creditor: ben, amount });
    expect(await readDebt(q.client, debtId, q.cfg)).toMatchObject({
      id: debtId,
      mandateId,
      reference: 'debt-001',
      debtor: ana,
      creditor: ben,
      amount,
      status: 'open',
      coinType: normalizeStructTag(SUI_TYPE),
    });

    const before = await totalBalance(q.client, ben);
    const settled = await signAndExecute(q.client, q.agent, settleTx(q.cfg, { mandateId, debtId, allowanceId, funder: ana, amount }));
    expect(settled.events.map((e) => e.eventType)).toContain(`${q.cfg.pkg}::settle::DebtSettled`);
    expect((await totalBalance(q.client, ben)) - before).toBe(amount);

    expect((await readDebt(q.client, debtId, q.cfg)).status).toBe('settled_allowance');
    expect(await readAllowance(q.client, allowanceId)).toMatchObject({
      funder: ana,
      spender: q.agent.toSuiAddress(),
      name: 'flat-5b',
      spent: amount,
      lifetimeCap: 3_000_000_000n,
      rateLimit: { limit: 2_000_000_000n, spent: amount, remaining: 2_000_000_000n - amount, window: { periodMs: 7 * 24 * 3600_000 } },
      remaining: 2_000_000_000n - amount,
    });
  });

  it('settle_wrong_amount_aborts_EAmountMismatch', async () => {
    const { mandateId, allowanceId } = await openLocalMandate(q, q.ana, { creditors: [ben], maxPerDebt: 1_000_000_000n });
    const debtId = await recordLocalDebt(q, { mandateId, reference: 'debt-002', creditor: ben, amount: 500_000_000n });

    const err = await signAndExecute(
      q.client,
      q.agent,
      settleTx(q.cfg, { mandateId, debtId, allowanceId, funder: ana, amount: 500_000_001n }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChainTxError);
    expect((err as ChainTxError).abort).toMatchObject({ module: 'settle', constant: 'EAmountMismatch' });
    expect((await readDebt(q.client, debtId, q.cfg)).status).toBe('open');
  });

  it('marks a debt paid externally and lets the debtor cancel another', async () => {
    const { mandateId } = await openLocalMandate(q, q.ana, { creditors: [ben], maxPerDebt: 1_000_000_000n });
    const paid = await recordLocalDebt(q, { mandateId, reference: 'debt-003', creditor: ben, amount: 10_000n });
    const objected = await recordLocalDebt(q, { mandateId, reference: 'debt-004', creditor: ben, amount: 20_000n });

    await signAndExecute(q.client, q.operator, markExternalTx(q.cfg, { debtId: paid }));
    await signAndExecute(q.client, q.ana, cancelDebtTx(q.cfg, { debtId: objected }));

    expect((await readDebt(q.client, paid, q.cfg)).status).toBe('settled_external');
    expect((await readDebt(q.client, objected, q.cfg)).status).toBe('cancelled');
  });

  it('refuses to read an object as the wrong type', async () => {
    await expect(readDebt(q.client, q.cfg.configId, q.cfg)).rejects.toMatchObject({ name: 'ChainObjectError' });
  });
});
