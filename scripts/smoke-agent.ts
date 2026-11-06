// Auto-settle smoke: a member with a mandate owes a small debt; the worker's agent
// records it on-chain and pays it through x402 after the objection window.
//   QUITS_WEB_URL=http://localhost:3100 tsx scripts/smoke-agent.ts
const base = (process.env.QUITS_WEB_URL ?? 'http://localhost:3100').replace(/\/$/, '');
let cookie = '';
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const first = await call('POST', '/api/demo/session', { as: 'ana' });
const tab = first.data.tab as string;
const key = first.data.tabKey as string;
const g0 = await call('GET', `/api/groups/${tab}`);
const debt = (g0.data.debts ?? []).find((x: any) => x.status === 'open' && BigInt(x.usdcMicro) <= 5_000_000n);
if (!debt) throw new Error('no small open debt in the tab');
const who = (g0.data.members ?? []).find((m: any) => m.id === debt.debtorId);
await call('POST', '/api/demo/session', { as: who.name, tab: key });
const m = await call('POST', `/api/groups/${tab}/autosettle`, {});
console.log(`${who.name} owes ${debt.usdcMicro} and turns on auto-settle:`, m.status, m.data.mandateObjectId ?? m.data.error);
const debtorId = debt.debtorId as string;
const started = Date.now();
for (;;) {
  const g = await call('GET', `/api/groups/${tab}`);
  const d = (g.data.debts ?? []).filter((x: any) => x.debtorId === debtorId);
  const ex = (g.data.expenses ?? []).length;
  console.log(`${Math.round((Date.now() - started) / 1000)}s`, d.map((x: any) => `${x.usdcMicro}→${x.creditorId} ${x.status}`).join(' | ') || 'no open debts', `(${ex} expenses)`);
  const proof = await call('GET', '/api/proof');
  const agentPaid = (proof.data.settlements ?? []).find((s: any) => s.status === 'settled_agent');
  if (agentPaid) {
    console.log('AGENT SETTLED', agentPaid.digest, agentPaid.explorer);
    break;
  }
  if (Date.now() - started > 240_000) {
    console.log('timed out');
    process.exitCode = 1;
    break;
  }
  await new Promise((r) => setTimeout(r, 10_000));
}
