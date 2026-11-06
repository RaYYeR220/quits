import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { createdObject, recordDebtTx, signAndExecute, ChainTxError, type QuitsChainConfig } from '@quits/chain';
import { debts, mandates } from '@quits/db';
import { buildAgentPayment, PAYMENT_SIGNATURE_HEADER, type X402Requirements } from '@quits/pay';
import type { Quits } from '@quits/service';

export interface AutoSettleDeps {
  q: Quits;
  client: ClientWithCoreApi;
  cfg: QuitsChainConfig;
  registrar: Signer;
  agent: Signer;
  /** Base URL of the Quits web app; the agent pays through its public x402 endpoint. */
  webUrl: string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * One pass of the settlement agent:
 * 1. open debts whose debtor has a mandate and is within their learned limit
 *    are recorded on-chain (the contract starts the objection window);
 * 2. recorded debts past their window are paid: the agent asks the debt's x402
 *    endpoint for the price and answers with a signed `quits::settle::settle`.
 */
export async function autoSettleOnce(d: AutoSettleDeps): Promise<{ recorded: number; paid: number; asked: number }> {
  const log = d.log ?? (() => {});
  const out = { recorded: 0, paid: 0, asked: 0 };
  const groupsWithMandates = await d.q.ctx.db.selectDistinct({ groupId: mandates.groupId }).from(mandates).where(eq(mandates.status, 'active'));

  for (const { groupId } of groupsWithMandates) {
    const live = await d.q.refreshDebts(groupId);
    const members = await d.q.members(groupId);
    const addr = (id: string) => members.find((m) => m.id === id)?.suiAddress ?? null;

    for (const debt of live.filter((x) => x.status === 'open')) {
      const decision = await d.q.autoSettleDecision(debt.id);
      if (decision.decision === 'ask') out.asked += 1;
      if (decision.decision !== 'record') continue;
      const creditor = addr(debt.creditorId);
      if (!creditor) continue;
      try {
        const tx = await signAndExecute(d.client, d.registrar, recordDebtTx(d.cfg, { mandateId: decision.mandateId, reference: debt.id, creditor, amount: debt.usdcMicro }));
        const onchainDebtId = createdObject(tx, /::settle::Debt</);
        const m = await d.q.activeMandate(debt.debtorId, groupId);
        await d.q.markRecorded(debt.id, {
          onchainDebtId,
          mandateId: decision.mandateId,
          pullableAt: new Date(Date.now() + (m?.objectionWindowMs ?? 0)),
        });
        out.recorded += 1;
        log('recorded', { debt: debt.id, onchainDebtId, digest: tx.digest });
      } catch (e) {
        log('record failed', { debt: debt.id, error: e instanceof ChainTxError ? (e.abort?.constant ?? e.message) : String(e) });
      }
    }
  }

  const due = await d.q.ctx.db
    .select()
    .from(debts)
    .where(and(eq(debts.status, 'recorded'), lte(debts.pullableAt, new Date())));
  for (const debt of due) {
    if (!debt.onchainDebtId || !debt.mandateId) continue;
    const [m] = await d.q.ctx.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.mandateObjectId, debt.mandateId), inArray(mandates.status, ['active'])))
      .limit(1);
    const funder = (await d.q.members(debt.groupId)).find((x) => x.id === debt.debtorId)?.suiAddress;
    if (!m || !funder) continue;
    const url = `${d.webUrl.replace(/\/$/, '')}/api/pay/${debt.id}`;
    try {
      const first = await fetch(url);
      if (first.status !== 402) {
        log('pay skipped', { debt: debt.id, status: first.status });
        continue;
      }
      const requirements = (await first.json()) as X402Requirements;
      const header = await buildAgentPayment(
        d.agent,
        d.cfg,
        { mandateId: m.mandateObjectId, debtId: debt.onchainDebtId, allowanceId: m.allowanceId, funder, amount: debt.usdcMicro },
        { client: d.client, requirements },
      );
      const paid = await fetch(url, { headers: { [PAYMENT_SIGNATURE_HEADER]: header } });
      const body = (await paid.json()) as { settled?: boolean; digest?: string; error?: string };
      if (paid.ok && body.settled) {
        out.paid += 1;
        log('paid', { debt: debt.id, digest: body.digest });
      } else {
        log('pay refused', { debt: debt.id, status: paid.status, error: body.error });
      }
    } catch (e) {
      log('pay failed', { debt: debt.id, error: e instanceof ChainTxError ? (e.abort?.constant ?? e.message) : String(e) });
    }
  }
  return out;
}
