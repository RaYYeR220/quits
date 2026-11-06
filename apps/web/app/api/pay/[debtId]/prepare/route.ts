import { eq } from 'drizzle-orm';
import { toBase64 } from '@mysten/sui/utils';
import { gaslessUsdcTx, withValidDuring } from '@quits/chain';
import { users } from '@quits/db';
import { chainConfig, getQuits, getSui } from '@/lib/deps.ts';
import { handle, HttpError, requireSession } from '@/lib/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type P = { params: Promise<{ debtId: string }> };

/**
 * The exact transfer a debt's x402 endpoint will accept, built for the debtor's
 * wallet to sign: gasless USDC to the creditor, valid for this epoch and the next.
 */
export const POST = handle(async (_req: Request, { params }: P) => {
  const s = await requireSession();
  if (s.demo) throw new HttpError(403, 'Demo flatmates pay from their demo wallets.');
  const { debtId } = await params;
  const q = await getQuits();
  const d = await q.debt(debtId);
  if (d.debtorId !== s.uid) throw new HttpError(403, 'You can only pay your own debts.');
  if (!d.status.startsWith('open') && d.status !== 'recorded') throw new HttpError(409, 'This debt is not open.');
  const [me] = await q.ctx.db.select().from(users).where(eq(users.id, s.uid)).limit(1);
  const creditor = (await q.members(d.groupId)).find((m) => m.id === d.creditorId)?.suiAddress;
  if (!me?.suiAddress || !creditor) throw new HttpError(409, 'Both members need a Sui address.');
  const client = getSui().client;
  const tx = gaslessUsdcTx({ to: creditor, amount: d.usdcMicro, usdcType: chainConfig().usdcType });
  tx.setSender(me.suiAddress);
  await withValidDuring(tx, client);
  const bytes = await tx.build({ client });
  return { txBytes: toBase64(bytes), amount: d.usdcMicro, to: creditor };
});
