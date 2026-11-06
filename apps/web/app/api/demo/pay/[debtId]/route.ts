import { gaslessUsdcTx, signAndExecute, withValidDuring } from '@quits/chain';
import { buildWalletPayment, paymentRequired, PAYMENT_SIGNATURE_HEADER } from '@quits/pay';
import { DEMO_MEMBERS } from '@quits/service';
import { chainConfig, demoSigner, getQuits, getSui, network } from '@/lib/deps.ts';
import { payDebt } from '@/lib/paydebt.ts';
import { handle, HttpError, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO_CAP = 1_000_000n;

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
  // server-held money only ever moves between the four demo wallets
  if (!DEMO_MEMBERS.some((m) => m.id === d.creditorId)) throw new HttpError(403, 'Demo wallets only pay other demo flatmates.');
  if (d.status !== 'open' && d.status !== 'recorded') throw new HttpError(409, 'This debt is already settled or was replaced.');
  if (d.usdcMicro > DEMO_CAP) throw new HttpError(400, 'Demo wallets settle debts up to 1 USDC. Try the Coffee tab.');
  const signer = demoSigner(s.uid);
  if (!signer) throw new HttpError(503, 'Demo wallets are not configured.');

  // Demo money pools with whoever is owed; if this wallet is short, top it up from the
  // richest demo wallet first (a separate gasless transfer, reported as such).
  const client = getSui().client;
  const usdc = chainConfig().usdcType;
  const balanceOf = async (addr: string) => BigInt((await client.core.getBalance({ owner: addr, coinType: usdc })).balance.addressBalance ?? '0');
  let topUp: { from: string; amount: string; digest: string } | null = null;
  const have = await balanceOf(signer.toSuiAddress());
  if (have < d.usdcMicro && network !== 'localnet') {
    const others = DEMO_MEMBERS.filter((m) => m.id !== s.uid)
      .map((m) => demoSigner(m.id))
      .filter((k): k is NonNullable<typeof k> => k !== null);
    const funds = await Promise.all(others.map(async (k) => ({ k, usdc: await balanceOf(k.toSuiAddress()) })));
    funds.sort((a, b) => (a.usdc > b.usdc ? -1 : 1));
    const need = d.usdcMicro - have + 50_000n;
    const donor = funds[0];
    if (!donor || donor.usdc < need) throw new HttpError(409, 'The demo wallets are low right now. Try a smaller bill.');
    const tx = gaslessUsdcTx({ to: signer.toSuiAddress(), amount: need, usdcType: usdc });
    tx.setSender(donor.k.toSuiAddress());
    await withValidDuring(tx, client);
    const r = await signAndExecute(client, donor.k, tx);
    topUp = { from: donor.k.toSuiAddress(), amount: need.toString(), digest: r.digest };
  }

  const url = new URL(`/api/pay/${debtId}`, req.url).toString();
  const first = await payDebt(q, new Request(url), debtId);
  if (first.status !== 402) return first;
  const challenge = await first.json();

  const members = await q.members(d.groupId);
  const creditor = members.find((m) => m.id === d.creditorId)?.suiAddress;
  if (!creditor) throw new HttpError(409, 'The creditor has no wallet yet.');
  const reqs = paymentRequired(
    { id: d.id, debtor: signer.toSuiAddress(), creditor, usdcMicro: d.usdcMicro },
    { resource: url, usdcType: chainConfig().usdcType, network: network === 'localnet' ? 'localnet' : 'mainnet' },
  ).body;
  const header = await buildWalletPayment(signer, reqs, { client });
  const second = await payDebt(q, new Request(url, { headers: { [PAYMENT_SIGNATURE_HEADER]: header } }), debtId);
  const receipt = await second.json();
  return { challenge, receipt, status: second.status, topUp };
});
