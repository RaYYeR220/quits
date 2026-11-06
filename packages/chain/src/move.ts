import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress, parseStructTag } from '@mysten/sui/utils';
import type { QuitsChainConfig } from './config.ts';

export const WEEK_MS = 7 * 24 * 3600_000;

type Amount = bigint | number;

export interface OpenMandateArgs {
  /** Group label; becomes the allowance name (≤ 128 bytes). */
  group: string;
  /** The Quits settlement agent, the allowance's only spender. */
  agent: string;
  lifetimeCap: Amount | null;
  weeklyLimit: Amount | null;
  expiresAtMs: Amount | null;
  creditors: string[];
  maxPerDebt: Amount;
  objectionWindowMs: Amount;
}

/**
 * Proposes an allowance bound to `quits::settle::APP` and opens the matching
 * mandate in one transaction. Signed by the funder.
 */
export function openMandateTx(cfg: QuitsChainConfig, a: OpenMandateArgs): Transaction {
  const tx = new Transaction();
  const rateLimitType = '0x2::allowance::RateLimit';
  const rateLimit =
    a.weeklyLimit === null
      ? tx.moveCall({ target: '0x1::option::none', typeArguments: [rateLimitType] })
      : tx.moveCall({
          target: '0x1::option::some',
          typeArguments: [rateLimitType],
          arguments: [
            tx.moveCall({
              target: '0x2::allowance::periodic_rate_limit',
              arguments: [tx.pure.u64(WEEK_MS), tx.pure.u256(BigInt(a.weeklyLimit))],
            }),
          ],
        });
  const proposal = tx.moveCall({
    target: '0x2::allowance::propose_for_app',
    typeArguments: [`0x2::balance::Balance<${cfg.usdcType}>`, `${cfg.pkg}::settle::APP`],
    arguments: [
      tx.pure.string(a.group),
      tx.pure.address(a.agent),
      tx.pure.option('u256', a.lifetimeCap === null ? null : BigInt(a.lifetimeCap)),
      tx.pure.option('u64', null),
      tx.pure.option('u64', a.expiresAtMs === null ? null : BigInt(a.expiresAtMs)),
      rateLimit,
    ],
  });
  tx.moveCall({
    target: `${cfg.pkg}::settle::open_mandate`,
    typeArguments: [cfg.usdcType],
    arguments: [
      tx.object(cfg.configId),
      proposal,
      tx.pure.vector('address', a.creditors),
      tx.pure.u64(BigInt(a.maxPerDebt)),
      tx.pure.u64(BigInt(a.objectionWindowMs)),
    ],
  });
  return tx;
}

/** Registrar records a debt the debtor's mandate covers. */
export function recordDebtTx(
  cfg: QuitsChainConfig,
  a: { mandateId: string; reference: string; creditor: string; amount: Amount },
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${cfg.pkg}::settle::record_debt`,
    typeArguments: [cfg.usdcType],
    arguments: [
      tx.object(cfg.configId),
      tx.object(a.mandateId),
      tx.pure.string(a.reference),
      tx.pure.address(a.creditor),
      tx.pure.u64(BigInt(a.amount)),
      tx.object.clock(),
    ],
  });
  return tx;
}

/** Agent pulls exactly `amount` from the funder's allowance and pays the debt's creditor. */
export function settleTx(
  cfg: QuitsChainConfig,
  a: { mandateId: string; debtId: string; allowanceId: string; funder: string; amount: Amount },
): Transaction {
  const tx = new Transaction();
  const withdrawal = tx.withdrawal({
    amount: BigInt(a.amount),
    type: cfg.usdcType,
    from: 'allowance',
    allowance: a.allowanceId,
    funder: a.funder,
  });
  tx.moveCall({
    target: `${cfg.pkg}::settle::settle`,
    typeArguments: [cfg.usdcType],
    arguments: [
      tx.object(cfg.configId),
      tx.object(a.mandateId),
      tx.object(a.debtId),
      tx.object(a.allowanceId),
      withdrawal,
      tx.object.clock(),
    ],
  });
  return tx;
}

/** Registrar marks a debt as paid outside the allowance. Moves no funds. */
export function markExternalTx(cfg: QuitsChainConfig, a: { debtId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${cfg.pkg}::settle::mark_settled_externally`,
    typeArguments: [cfg.usdcType],
    arguments: [tx.object(cfg.configId), tx.object(a.debtId)],
  });
  return tx;
}

/** Debtor objects to a debt, or the registrar withdraws it. */
export function cancelDebtTx(cfg: QuitsChainConfig, a: { debtId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${cfg.pkg}::settle::cancel_debt`,
    typeArguments: [cfg.usdcType],
    arguments: [tx.object(cfg.configId), tx.object(a.debtId)],
  });
  return tx;
}

/** Funder closes their mandate (the allowance is revoked separately with its cap). */
export function closeMandateTx(cfg: QuitsChainConfig, a: { mandateId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: `${cfg.pkg}::settle::close_mandate`, arguments: [tx.object(a.mandateId)] });
  return tx;
}

/** Admin sets who records debts and who may spend allowances. */
export function setRolesTx(cfg: QuitsChainConfig, a: { adminCapId: string; registrar: string; agent: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${cfg.pkg}::settle::set_roles`,
    arguments: [tx.object(a.adminCapId), tx.object(cfg.configId), tx.pure.address(a.registrar), tx.pure.address(a.agent)],
  });
  return tx;
}

export type DebtStatus = 'open' | 'settled_allowance' | 'settled_external' | 'cancelled';
const DEBT_STATUS: readonly DebtStatus[] = ['open', 'settled_allowance', 'settled_external', 'cancelled'];

export interface MandateState {
  id: string;
  funder: string;
  group: string;
  creditors: string[];
  maxPerDebt: bigint;
  objectionWindowMs: number;
}

export interface DebtState {
  id: string;
  mandateId: string;
  group: string;
  /** Off-chain Quits debt id. */
  reference: string;
  debtor: string;
  creditor: string;
  amount: bigint;
  recordedAtMs: number;
  status: DebtStatus;
  coinType: string;
}

export interface AllowanceState {
  id: string;
  funder: string;
  spender: string | null;
  /** Type name of the app the allowance is bound to. */
  app: string | null;
  name: string;
  /** Lifetime total withdrawn. */
  spent: bigint;
  lifetimeCap: bigint | null;
  startsAtMs: number | null;
  expiresAtMs: number | null;
  rateLimit: {
    limit: bigint;
    /** Spent in the current window. */
    spent: bigint;
    window: { periodMs: number } | { months: number };
    remaining: bigint;
  } | null;
  /** What can still be withdrawn right now under both caps. */
  remaining: bigint;
}

/** A Sui object that is not what the caller expected. */
export class ChainObjectError extends Error {
  override name = 'ChainObjectError';

  constructor(
    readonly objectId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Object ${objectId} is ${actual}, expected ${expected}`);
  }
}

const MandateBcs = bcs.struct('Mandate', {
  id: bcs.Address,
  funder: bcs.Address,
  group: bcs.string(),
  creditors: bcs.struct('VecSet', { contents: bcs.vector(bcs.Address) }),
  max_per_debt: bcs.u64(),
  objection_window_ms: bcs.u64(),
});

const DebtBcs = bcs.struct('Debt', {
  id: bcs.Address,
  mandate: bcs.Address,
  group: bcs.string(),
  reference: bcs.string(),
  debtor: bcs.Address,
  creditor: bcs.Address,
  amount: bcs.u64(),
  recorded_at_ms: bcs.u64(),
  status: bcs.u8(),
});

const WindowBcs = bcs.enum('Window', { PeriodicMs: bcs.u64(), CalendarMonths: bcs.u8() });

const RateLimitBcs = bcs.enum('RateLimit', {
  Windowed: bcs.struct('Windowed', {
    limit: bcs.u256(),
    spent: bcs.u256(),
    anchor_ms: bcs.option(bcs.u64()),
    index: bcs.u64(),
    window: WindowBcs,
  }),
});

const AllowanceBcs = bcs.struct('Allowance', {
  id: bcs.Address,
  settings: bcs.struct('Settings', {
    funder: bcs.Address,
    spender: bcs.option(bcs.Address),
    app: bcs.option(bcs.struct('TypeName', { name: bcs.string() })),
    lifetime_cap: bcs.option(bcs.u256()),
    start_timestamp_ms: bcs.option(bcs.u64()),
    expiration_timestamp_ms: bcs.option(bcs.u64()),
    rate_limit: bcs.option(RateLimitBcs),
    name: bcs.string(),
  }),
  current_spend: bcs.u256(),
});

async function fetchContent(client: ClientWithCoreApi, id: string) {
  const { object } = await client.core.getObject({ objectId: id, include: { content: true } });
  return { type: object.type, content: object.content };
}

function expectType(id: string, type: string, pkg: string | undefined, module: string, name: string) {
  const tag = parseStructTag(type);
  const pkgOk = pkg === undefined || normalizeSuiAddress(tag.address) === normalizeSuiAddress(pkg);
  if (!pkgOk || tag.module !== module || tag.name !== name) {
    throw new ChainObjectError(id, `${pkg ?? '<quits>'}::${module}::${name}`, type);
  }
  return tag;
}

/** Reads a mandate; with `cfg`, also checks it belongs to that package. */
export async function readMandate(client: ClientWithCoreApi, id: string, cfg?: Pick<QuitsChainConfig, 'pkg'>): Promise<MandateState> {
  const { type, content } = await fetchContent(client, id);
  expectType(id, type, cfg?.pkg, 'settle', 'Mandate');
  const m = MandateBcs.parse(content);
  return {
    id: normalizeSuiAddress(m.id),
    funder: m.funder,
    group: m.group,
    creditors: m.creditors.contents,
    maxPerDebt: BigInt(m.max_per_debt),
    objectionWindowMs: Number(m.objection_window_ms),
  };
}

/** Reads a debt; with `cfg`, also checks it belongs to that package. */
export async function readDebt(client: ClientWithCoreApi, id: string, cfg?: Pick<QuitsChainConfig, 'pkg'>): Promise<DebtState> {
  const { type, content } = await fetchContent(client, id);
  const tag = expectType(id, type, cfg?.pkg, 'settle', 'Debt');
  const d = DebtBcs.parse(content);
  const status = DEBT_STATUS[d.status];
  const coin = tag.typeParams[0];
  if (!status || coin === undefined) throw new ChainObjectError(id, 'a quits debt', `${type} with status ${d.status}`);
  return {
    id: normalizeSuiAddress(d.id),
    mandateId: d.mandate,
    group: d.group,
    reference: d.reference,
    debtor: d.debtor,
    creditor: d.creditor,
    amount: BigInt(d.amount),
    recordedAtMs: Number(d.recorded_at_ms),
    status,
    coinType: normalizeStructTag(coin),
  };
}

/** Reads an allowance and works out what it still lets the spender withdraw at `nowMs`. */
export async function readAllowance(client: ClientWithCoreApi, id: string, nowMs = Date.now()): Promise<AllowanceState> {
  const { type, content } = await fetchContent(client, id);
  expectType(id, type, '0x2', 'allowance', 'Allowance');
  const a = AllowanceBcs.parse(content);
  const s = a.settings;
  const spent = BigInt(a.current_spend);
  const lifetimeCap = s.lifetime_cap === null ? null : BigInt(s.lifetime_cap);

  let rateLimit: AllowanceState['rateLimit'] = null;
  if (s.rate_limit) {
    const w = s.rate_limit.Windowed;
    const window = w.window.$kind === 'PeriodicMs' ? { periodMs: Number(w.window.PeriodicMs) } : { months: Number(w.window.CalendarMonths) };
    const anchor = w.anchor_ms === null ? null : Number(w.anchor_ms);
    const rolledOver = anchor !== null && windowIndex(window, anchor, nowMs) > Number(w.index);
    const windowSpent = rolledOver ? 0n : BigInt(w.spent);
    const limit = BigInt(w.limit);
    rateLimit = { limit, spent: windowSpent, window, remaining: limit > windowSpent ? limit - windowSpent : 0n };
  }

  const expiresAtMs = s.expiration_timestamp_ms === null ? null : Number(s.expiration_timestamp_ms);
  const startsAtMs = s.start_timestamp_ms === null ? null : Number(s.start_timestamp_ms);
  const live = (expiresAtMs === null || nowMs < expiresAtMs) && (startsAtMs === null || nowMs >= startsAtMs);
  const caps = [lifetimeCap === null ? null : lifetimeCap > spent ? lifetimeCap - spent : 0n, rateLimit?.remaining ?? null].filter(
    (v): v is bigint => v !== null,
  );

  return {
    id: normalizeSuiAddress(a.id),
    funder: s.funder,
    spender: s.spender,
    app: s.app?.name ?? null,
    name: s.name,
    spent,
    lifetimeCap,
    startsAtMs,
    expiresAtMs,
    rateLimit,
    remaining: live && caps.length > 0 ? caps.reduce((x, y) => (x < y ? x : y)) : 0n,
  };
}

/** Mirrors `sui::allowance` window numbering (periodic or civil-month windows from the anchor). */
function windowIndex(window: { periodMs: number } | { months: number }, anchorMs: number, nowMs: number): number {
  if ('periodMs' in window) return Math.floor((nowMs - anchorMs) / window.periodMs);
  const a = new Date(anchorMs);
  const n = new Date(nowMs);
  let elapsed = n.getUTCFullYear() * 12 + n.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth());
  const daysInMonth = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
  if (elapsed > 0 && n.getUTCDate() < Math.min(a.getUTCDate(), daysInMonth)) elapsed -= 1;
  return Math.floor(elapsed / window.months);
}
