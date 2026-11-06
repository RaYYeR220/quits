import { fromBase64, normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import { and, gt, inArray, sql } from 'drizzle-orm';
import { createdObject, openMandateTx, readMandate, signAndExecute, type ExecutedTx } from '@quits/chain';
import { mandates } from '@quits/db';
import { DEMO_MEMBERS, type Quits } from '@quits/service';
import { agentAddress, chainConfig, demoSigner, getSui } from './deps.ts';
import { HttpError } from './route.ts';

/** Bounds every demo mandate uses; real members choose their own. */
export const DEMO_TERMS = {
  lifetimeCap: 3_000_000n,
  weeklyLimit: 2_000_000n,
  maxPerDebt: 1_000_000n,
  objectionWindowMs: 60_000,
  days: 7,
};

export interface Terms {
  lifetimeCap: bigint;
  weeklyLimit: bigint;
  maxPerDebt: bigint;
  objectionWindowMs: number;
  days: number;
}

const DEMO_IDS: string[] = DEMO_MEMBERS.map((m) => m.id);
/** Demo mandates cost the demo wallets gas; keep a ceiling on how many visitors can open per hour. */
const DEMO_MANDATES_PER_HOUR = 20;

async function creditorsOf(q: Quits, groupId: string, uid: string, demoOnly = false) {
  const ms = (await q.members(groupId)).filter((m) => m.id !== uid && m.suiAddress && (!demoOnly || DEMO_IDS.includes(m.id)));
  if (ms.length === 0) throw new HttpError(409, 'Nobody else in this group has a Sui address yet.');
  return { ids: ms.map((m) => m.id), addresses: ms.map((m) => m.suiAddress!) };
}

function build(groupId: string, creditors: string[], t: Terms) {
  return openMandateTx(chainConfig(), {
    group: groupId,
    agent: agentAddress(),
    lifetimeCap: t.lifetimeCap,
    weeklyLimit: t.weeklyLimit,
    expiresAtMs: BigInt(Date.now() + t.days * 86_400_000),
    creditors,
    maxPerDebt: t.maxPerDebt,
    objectionWindowMs: BigInt(t.objectionWindowMs),
  });
}

async function store(q: Quits, uid: string, groupId: string, creditorIds: string[], t: Terms, tx: Pick<ExecutedTx, 'effects' | 'objectTypes' | 'digest'>) {
  const pkg = normalizeSuiAddress(chainConfig().pkg);
  const mandateObjectId = createdObject(tx, new RegExp(`^${pkg}::settle::Mandate$`));
  const allowanceId = createdObject(tx, /::allowance::Allowance</);
  await q.ctx.db.insert(mandates).values({
    id: q.ctx.id(),
    userId: uid,
    groupId,
    allowanceId,
    mandateObjectId,
    lifetimeCap: t.lifetimeCap,
    weeklyLimit: t.weeklyLimit,
    maxPerDebt: t.maxPerDebt,
    objectionWindowMs: t.objectionWindowMs,
    creditors: creditorIds,
    expiresAt: new Date(Date.now() + t.days * 86_400_000),
    openTx: tx.digest,
  });
  return { mandateObjectId, allowanceId, digest: tx.digest };
}

/** Demo member turns on auto-settle: their server wallet signs a real allowance + mandate. */
export async function openDemoMandate(q: Quits, uid: string, groupId: string) {
  if (await q.activeMandate(uid, groupId)) throw new HttpError(409, 'Auto-settle is already on for this group.');
  const signer = demoSigner(uid);
  if (!signer) throw new HttpError(503, 'Demo wallets are not configured.');
  const [recent] = await q.ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(mandates)
    .where(and(inArray(mandates.userId, DEMO_IDS), gt(mandates.createdAt, new Date(Date.now() - 3_600_000))));
  if ((recent?.n ?? 0) >= DEMO_MANDATES_PER_HOUR) throw new HttpError(429, 'Lots of visitors are trying auto-settle right now. Try again in a few minutes.');
  const c = await creditorsOf(q, groupId, uid, true);
  const tx = await signAndExecute(getSui().client, signer, build(groupId, c.addresses, DEMO_TERMS));
  return store(q, uid, groupId, c.ids, DEMO_TERMS, tx);
}

/** Real member: the transaction they sign in their wallet. */
export async function prepareMandate(q: Quits, uid: string, address: string, groupId: string, t: Terms) {
  const c = await creditorsOf(q, groupId, uid);
  const tx = build(groupId, c.addresses, t);
  tx.setSender(address);
  const bytes = await tx.build({ client: getSui().client });
  return { txBytes: toBase64(bytes), creditors: c.ids };
}

/** Real member: execute the transaction their wallet signed (through Tatum) and record the mandate. */
export async function confirmMandate(q: Quits, uid: string, address: string, groupId: string, signed: { txBytes: string; signature: string }, t: Terms) {
  const client = getSui().client;
  const res = await client.core.executeTransaction({
    transaction: fromBase64(signed.txBytes),
    signatures: [signed.signature],
    include: { effects: true, objectTypes: true, transaction: true },
  });
  const txr = res.$kind === 'Transaction' ? res.Transaction : null;
  if (!txr || !txr.effects?.status.success) throw new HttpError(400, 'That transaction did not succeed.');
  if (normalizeSuiAddress(txr.transaction?.sender ?? '') !== normalizeSuiAddress(address)) throw new HttpError(403, 'That transaction was not sent by you.');
  await client.core.waitForTransaction({ digest: txr.digest });
  const c = await creditorsOf(q, groupId, uid);
  // Record what the chain holds, not what the request says: the mandate must be ours, for this group, funded by
  // this member, paying exactly the group's other members, within the terms they were shown.
  const pkg = normalizeSuiAddress(chainConfig().pkg);
  const mandateId = createdObject(txr as unknown as ExecutedTx, new RegExp(`^${pkg}::settle::Mandate$`));
  if (!mandateId) throw new HttpError(400, 'That transaction did not open a Quits mandate.');
  const m = await readMandate(client, mandateId, chainConfig());
  const same = (a: string[], b: string[]) => a.length === b.length && a.map((x) => normalizeSuiAddress(x)).sort().join() === b.map((x) => normalizeSuiAddress(x)).sort().join();
  if (m.group !== groupId) throw new HttpError(400, 'That mandate is for another group.');
  if (normalizeSuiAddress(m.funder) !== normalizeSuiAddress(address)) throw new HttpError(403, 'That mandate is funded by someone else.');
  if (!same(m.creditors, c.addresses)) throw new HttpError(400, 'That mandate pays different people than this group.');
  if (m.maxPerDebt > t.maxPerDebt || m.objectionWindowMs < Math.min(t.objectionWindowMs, 60_000)) throw new HttpError(400, 'That mandate does not match the terms you were shown.');
  return store(q, uid, groupId, c.ids, { ...t, maxPerDebt: m.maxPerDebt, objectionWindowMs: m.objectionWindowMs }, txr as unknown as ExecutedTx);
}
