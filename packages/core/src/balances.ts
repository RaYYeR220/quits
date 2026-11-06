import { GASLESS_FLOOR, sumMicro, type Micro } from './money.ts';
import type { MemberId } from './types.ts';

export interface PostedExpense {
  payerId: MemberId;
  usdcMicro: Micro;
  shares: Record<MemberId, Micro>;
}

export interface Transfer {
  from: MemberId;
  to: MemberId;
  usdcMicro: Micro;
}

/** Net position per member: positive means the group owes them. */
export function balances(expenses: readonly PostedExpense[], settlements: readonly Transfer[]): Record<MemberId, Micro> {
  const b: Record<MemberId, Micro> = {};
  const add = (m: MemberId, v: Micro) => {
    b[m] = (b[m] ?? 0n) + v;
  };
  for (const e of expenses) {
    if (sumMicro(Object.values(e.shares)) !== e.usdcMicro) throw new Error('balances: shares do not add up to the expense');
    add(e.payerId, e.usdcMicro);
    for (const [m, v] of Object.entries(e.shares)) add(m, -v);
  }
  for (const s of settlements) {
    add(s.from, s.usdcMicro);
    add(s.to, -s.usdcMicro);
  }
  return b;
}

/**
 * Turns net balances into the fewest transfers the greedy rule finds: the largest
 * debtor pays the largest creditor until one of them is even, repeat. Ties go to
 * the lower member id. Transfers under `floor` are dropped (they can't move as a
 * gasless USDC transfer and stay on the tab).
 */
export function settleUp(bal: Record<MemberId, Micro>, floor: Micro = GASLESS_FLOOR): Transfer[] {
  if (sumMicro(Object.values(bal)) !== 0n) throw new Error('settleUp: balances do not net to zero');
  const creditors = Object.entries(bal).filter(([, v]) => v > 0n).map(([id, v]) => ({ id, v }));
  const debtors = Object.entries(bal).filter(([, v]) => v < 0n).map(([id, v]) => ({ id, v: -v }));
  const order = (x: { id: string; v: bigint }, y: { id: string; v: bigint }) =>
    x.v === y.v ? (x.id < y.id ? -1 : 1) : x.v > y.v ? -1 : 1;

  const out: Transfer[] = [];
  for (;;) {
    creditors.sort(order);
    debtors.sort(order);
    const c = creditors[0];
    const d = debtors[0];
    if (!c || !d || c.v === 0n || d.v === 0n) break;
    const amt = c.v < d.v ? c.v : d.v;
    if (amt >= floor) out.push({ from: d.id, to: c.id, usdcMicro: amt });
    c.v -= amt;
    d.v -= amt;
  }
  return out;
}
