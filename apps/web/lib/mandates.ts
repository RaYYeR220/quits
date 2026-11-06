import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { createdObject, openMandateTx, signAndExecute, type ExecutedTx } from '@quits/chain';
import { mandates } from '@quits/db';
import type { Quits } from '@quits/service';
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

async function creditorsOf(q: Quits, groupId: string, uid: string) {
  const ms = (await q.members(groupId)).filter((m) => m.id !== uid && m.suiAddress);
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
  const mandateObjectId = createdObject(tx, /::settle::Mandate$/);
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
  const c = await creditorsOf(q, groupId, uid);
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
  if (txr.transaction?.sender !== address) throw new HttpError(403, 'That transaction was not sent by you.');
  await client.core.waitForTransaction({ digest: txr.digest });
  const c = await creditorsOf(q, groupId, uid);
  return store(q, uid, groupId, c.ids, t, txr as unknown as ExecutedTx);
}
