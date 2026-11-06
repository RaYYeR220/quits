import { getQuits } from '@/lib/deps.ts';
import { payDebt } from '@/lib/paydebt.ts';
import { handle } from '@/lib/route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type P = { params: Promise<{ debtId: string }> };

/** Every open Quits debt is an x402 resource: GET it to see the price, pay to settle it. */
export const GET = handle(async (req: Request, { params }: P) => payDebt(await getQuits(), req, (await params).debtId));
export const POST = GET;
