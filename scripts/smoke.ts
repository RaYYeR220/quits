// End-to-end smoke test against a running Quits web app (local or deployed).
//   QUITS_WEB_URL=http://localhost:3100 tsx scripts/smoke.ts
const base = (process.env.QUITS_WEB_URL ?? 'http://localhost:3100').replace(/\/$/, '');
let cookie = '';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data: data as Record<string, any>, headers: res.headers };
}

function step(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`}`);
  if (!ok) process.exitCode = 1;
}

const t0 = Date.now();
const s = await call('POST', '/api/demo/session', { as: 'ana' });
step('demo session as Ana', s.status === 200, s.data);
const tab = s.data.tab as string;

const g = await call('GET', `/api/groups/${tab}`);
step('coffee tab loads with debts', g.status === 200 && Array.isArray(g.data.debts), { debts: g.data.debts?.length, members: g.data.members?.length });

const flat = await call('GET', '/api/groups/demo-flat-5b/rules');
step('Flat 5B has learned rules', flat.status === 200 && flat.data.rules?.length >= 5, flat.data.rules?.map((r: any) => `${r.sentence} [${r.memoryState}]`));

const add = await call('POST', `/api/groups/${tab}/expenses`, { text: 'Pizza night 24 USD, I paid, 8 of it was beer' });
step('add expense in plain words', add.status === 200 && add.data.ok, add.data.proposal ? { shares: add.data.proposal.shares, why: add.data.proposal.why?.map((w: any) => w.sentence) } : add.data);

if (add.data.ok) {
  const draft = add.data.proposal.draftId;
  const fix = await call('POST', `/api/expenses/${draft}/correct`, { text: 'Dan was not there, leave him out of pizza night' });
  step('correct it', fix.status === 200, fix.data.ok ? { learned: fix.data.learned, shares: fix.data.proposal.shares } : fix.data);
  const acc = await call('POST', `/api/expenses/${draft}/accept`);
  step('accept', acc.status === 200, { debts: acc.data.debts?.length });
}

const g2 = await call('GET', `/api/groups/${tab}`);
const mine = (g2.data.debts ?? []).find((d: any) => d.status === 'open' && d.usdcMicro && BigInt(d.usdcMicro) <= 5_000_000n);
step('there is a small open debt', Boolean(mine), mine);
if (mine) {
  const debtor = (g2.data.members ?? []).find((m: any) => m.id === mine.debtorId);
  const sw = await call('POST', '/api/demo/session', { as: debtor?.name, tab: s.data.tabKey });
  step(`switch to the debtor (${debtor?.name}) in the same tab`, sw.status === 200 && sw.data.tab === tab, sw.data);
}

if (mine) {
  const ask = await call('GET', `/api/pay/${mine.id}`);
  step('x402: debt answers 402 with exact sui', ask.status === 402 && ask.data.accepts?.[0]?.scheme === 'exact', { network: ask.data.accepts?.[0]?.network, amount: ask.data.accepts?.[0]?.amount, mpp: Boolean(ask.headers.get('www-authenticate')) });
  const pay = await call('POST', `/api/demo/pay/${mine.id}`);
  step('demo wallet pays through x402', pay.status === 200 && pay.data.receipt?.settled, pay.data.receipt ?? pay.data);
  const again = await call('GET', `/api/pay/${mine.id}`);
  step('paid debt returns its receipt (idempotent)', again.status === 200 && again.data.settled, again.data);
}

const mandate = await call('POST', `/api/groups/${tab}/autosettle`, {});
step('auto-settle mandate opens on-chain', mandate.status === 200 && Boolean(mandate.data.mandateObjectId), mandate.data);

const proof = await call('GET', '/api/proof');
step('proof page', proof.status === 200, { memories: proof.data.memories?.stored, settlements: proof.data.settlements?.length, backend: proof.data.memoryBackend });

console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
