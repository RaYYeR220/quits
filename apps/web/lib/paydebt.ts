import {
  PaymentHeaderError,
  mppReceiptHeaders,
  paymentFromHeaders,
  paymentRequired,
  settlementHeaders,
  verifyAndSettle,
  verifyMppPayment,
  type PaymentExpectation,
  type SettleResult,
} from '@quits/pay';
import type { DebtRow, Quits } from '@quits/service';
import { agentAddress, chainConfig, getSui, network, settlementStore } from './deps.ts';
import { json } from './json.ts';

export const explorerTx = (digest: string) => `https://suiscan.xyz/${network === 'localnet' ? 'localnet' : 'mainnet'}/tx/${digest}`;

async function parties(q: Quits, d: DebtRow) {
  const members = await q.members(d.groupId);
  const debtor = members.find((m) => m.id === d.debtorId)?.suiAddress ?? null;
  const creditor = members.find((m) => m.id === d.creditorId)?.suiAddress ?? null;
  return { debtor, creditor };
}

function settled(d: DebtRow) {
  return d.status.startsWith('settled_') && d.txDigest;
}

/**
 * The x402 resource behind every open debt. Without a payment it answers 402
 * (x402 v2 `exact` on Sui + an MPP `sui` challenge). With one it verifies the
 * signed transaction through Tatum, executes it once, and returns the receipt.
 */
export async function payDebt(q: Quits, req: Request, debtId: string): Promise<Response> {
  const d = await q.debt(debtId);
  const net = `sui:${network === 'localnet' ? 'localnet' : 'mainnet'}` as const;
  if (settled(d)) {
    return json({ settled: true, debtId, digest: d.txDigest, explorer: explorerTx(d.txDigest!) }, { headers: settlementHeaders({ digest: d.txDigest! }, net) });
  }
  if (d.status === 'cancelled') return json({ error: 'This debt was replaced by a newer one.' }, { status: 410 });

  const { debtor, creditor } = await parties(q, d);
  if (!debtor || !creditor) return json({ error: 'Both members need a Sui address before this debt can be paid.' }, { status: 409 });

  const cfg = chainConfig();
  const resource = new URL(req.url).toString().split('?')[0]!;
  const ask = (error?: string) => {
    const r = paymentRequired({ id: d.id, debtor, creditor, usdcMicro: d.usdcMicro }, { resource, usdcType: cfg.usdcType, network: network === 'localnet' ? 'localnet' : 'mainnet', ...(error ? { error } : {}) });
    return json(r.body, { status: 402, headers: r.headers });
  };

  const expect: PaymentExpectation = {
    debtId: d.id,
    debtor,
    creditor,
    amount: d.usdcMicro,
    agent: agentAddress(),
    quitsPkg: cfg.pkg,
    coinType: cfg.usdcType,
  };
  const store = await settlementStore();
  const client = getSui().client;

  let result: SettleResult;
  let mpp = false;
  const authz = req.headers.get('authorization');
  try {
    const payment = paymentFromHeaders(req.headers);
    if (payment) result = await verifyAndSettle(client, payment, expect, { store });
    else if (authz?.startsWith('Payment ')) {
      mpp = true;
      result = await verifyMppPayment(client, authz, expect, { store });
    } else return ask();
  } catch (e) {
    if (e instanceof PaymentHeaderError) return ask(e.message);
    throw e;
  }

  if (!result.ok && result.reason === 'already_settled' && result.digest) {
    return json({ settled: true, debtId, digest: result.digest, explorer: explorerTx(result.digest) }, { headers: settlementHeaders({ digest: result.digest }, net) });
  }
  if (!result.ok) {
    if (result.reason === 'in_progress') return json({ error: 'This payment is being settled right now.' }, { status: 409 });
    return ask(`${result.reason}${result.detail ? `: ${result.detail}` : ''}`);
  }

  const marked = await q.markPaid(d.id, { method: result.via === 'agent' ? 'agent' : 'wallet', digest: result.digest });
  const headers = { ...settlementHeaders({ digest: result.digest, payer: result.payer }, net), ...(mpp ? mppReceiptHeaders({ digest: result.digest }) : {}) };
  return json({ settled: true, debtId, digest: result.digest, via: result.via, explorer: explorerTx(result.digest), status: marked.debt.status }, { headers });
}
