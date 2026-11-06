import { buildWalletPayment, paymentRequired, PAYMENT_SIGNATURE_HEADER } from '@quits/pay';
import { chainConfig, demoSigner, getQuits, getSui, network } from '@/lib/deps.ts';
import { payDebt } from '@/lib/paydebt.ts';
import { handle, HttpError, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO_CAP = 5_000_000n;

type P = { params: Promise<{ debtId: string }> };

/**
 * A demo member pays a debt for real: their server-held wallet answers the
 * debt's 402 with a signed gasless USDC transfer and sends it back to the
 * same x402 endpoint any wallet or agent uses. Returns both legs.
 */
export const POST = handle(async (req: Request, { params }: P) => {
  const s = await requireSession();
  if (!s.demo) throw new HttpError(403, 'Only demo members pay from demo wallets.');
  const { debtId } = await params;
  const q = await getQuits();
  const d = await q.debt(debtId);
  if (d.debtorId !== s.uid) throw new HttpError(403, 'You can only pay your own debts.');
  if (d.usdcMicro > DEMO_CAP) throw new HttpError(400, 'Demo wallets settle debts up to 5 USDC. Try the Coffee tab.');
  const signer = demoSigner(s.uid);
  if (!signer) throw new HttpError(503, 'Demo wallets are not configured.');

  const url = new URL(`/api/pay/${debtId}`, req.url).toString();
  const first = await payDebt(q, new Request(url), debtId);
  if (first.status !== 402) return first;
  const challenge = await first.json();

  const members = await q.members(d.groupId);
  const creditor = members.find((m) => m.id === d.creditorId)?.suiAddress;
  const reqs = paymentRequired(
    { id: d.id, debtor: signer.toSuiAddress(), creditor: creditor!, usdcMicro: d.usdcMicro },
    { resource: url, usdcType: chainConfig().usdcType, network: network === 'localnet' ? 'localnet' : 'mainnet' },
  ).body;
  const header = await buildWalletPayment(signer, reqs, { client: getSui().client });
  const second = await payDebt(q, new Request(url, { headers: { [PAYMENT_SIGNATURE_HEADER]: header } }), debtId);
  const receipt = await second.json();
  return { challenge, receipt, status: second.status };
});
