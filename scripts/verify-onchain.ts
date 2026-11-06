// Checks every on-chain claim Quits makes, straight from Sui mainnet.
//   pnpm verify:onchain            (public fullnode)
//   TATUM_API_KEY=... pnpm verify:onchain   (through Tatum's gateway)
// Reads deployments/mainnet.json (package, config, roles) and deployments/proof.json
// (settlement digests, mandate/allowance ids, the memory owner + delegate key).
import { existsSync, readFileSync } from 'node:fs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { createTatumSui, listMemoryReceipts, readAllowance, readDebt, readMandate } from '@quits/chain';

type Proof = {
  walletPayments?: string[];
  agentPayments?: string[];
  externalPayments?: string[];
  debts?: string[];
  mandates?: { mandate: string; allowance: string }[];
  memory?: { owner: string; agentId: string };
};

const dep = JSON.parse(readFileSync('deployments/mainnet.json', 'utf8')) as { package: string; config: string; registrar: string; agent: string; usdc: string };
const proof: Proof = existsSync('deployments/proof.json') ? JSON.parse(readFileSync('deployments/proof.json', 'utf8')) : {};

const key = process.env.TATUM_API_KEY;
const { client, graphql } = key
  ? createTatumSui({ apiKey: key, network: 'mainnet' })
  : { client: new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }), graphql: new SuiGraphQLClient({ network: 'mainnet', url: 'https://graphql.mainnet.sui.io/graphql' }) };

let failed = 0;
const ok = (msg: string) => console.log(`✅ ${msg}`);
const bad = (msg: string) => {
  failed += 1;
  console.log(`❌ ${msg}`);
};
const scan = (kind: 'tx' | 'object', id: string) => `https://suiscan.xyz/mainnet/${kind}/${id}`;

console.log(`Checking Quits on Sui mainnet via ${key ? 'Tatum gRPC + GraphQL' : 'public fullnode'}\n`);

// 1. The settlement package and its roles
const pkg = await client.core.getObject({ objectId: dep.package });
pkg.object ? ok(`package ${dep.package} is published  ${scan('object', dep.package)}`) : bad(`package ${dep.package} not found`);
const cfg = await client.core.getObject({ objectId: dep.config, include: { json: true } });
const cj = (cfg.object as { json?: { registrar?: string; agent?: string; paused?: boolean } } | undefined)?.json;
if (cj?.registrar === dep.registrar && cj?.agent === dep.agent && cj?.paused === false) ok(`Config names registrar ${dep.registrar.slice(0, 10)}… and agent ${dep.agent.slice(0, 10)}…, not paused`);
else bad(`Config roles differ from deployments/mainnet.json: ${JSON.stringify(cj)}`);

// 2. Payments
async function checkTx(digest: string, label: string, expectEvent?: string) {
  try {
    const r = await client.core.getTransaction({ digest, include: { effects: true, events: true, balanceChanges: true } });
    const t = r.$kind === 'Transaction' ? r.Transaction : r.FailedTransaction;
    if (!t.effects?.status.success) return bad(`${label} ${digest} did not succeed`);
    const usdc = (t.balanceChanges ?? []).filter((b) => b.coinType.endsWith('::usdc::USDC') && BigInt(b.amount) > 0n);
    const evOk = !expectEvent || (t.events ?? []).some((e) => e.eventType.includes(expectEvent));
    if (!evOk) return bad(`${label} ${digest} has no ${expectEvent} event`);
    ok(`${label}: ${usdc.map((b) => `${(Number(b.amount) / 1e6).toFixed(2)} USDC → ${b.address.slice(0, 10)}…`).join(', ') || 'no USDC moved'}  ${scan('tx', digest)}`);
  } catch (e) {
    bad(`${label} ${digest}: ${e instanceof Error ? e.message : e}`);
  }
}
for (const d of proof.walletPayments ?? []) await checkTx(d, 'x402 wallet payment (gasless USDC)');
for (const d of proof.agentPayments ?? []) await checkTx(d, 'agent payment through the mandate', '::settle::DebtSettled');
for (const d of proof.externalPayments ?? []) await checkTx(d, 'direct transfer matched by the watcher');

// 3. Debts and mandates as the contract sees them
for (const id of proof.debts ?? []) {
  try {
    const d = await readDebt(client, id, { pkg: dep.package });
    ok(`Debt ${id.slice(0, 10)}…: ${(Number(d.amount) / 1e6).toFixed(2)} USDC, ${d.debtor.slice(0, 8)}… → ${d.creditor.slice(0, 8)}…, status ${d.status}`);
  } catch (e) {
    bad(`Debt ${id}: ${e instanceof Error ? e.message : e}`);
  }
}
for (const m of proof.mandates ?? []) {
  try {
    const [md, al] = await Promise.all([readMandate(client, m.mandate, { pkg: dep.package }), readAllowance(client, m.allowance)]);
    ok(
      `Mandate ${m.mandate.slice(0, 10)}…: funder ${md.funder.slice(0, 8)}…, ${md.creditors.length} creditors, ≤ ${(Number(md.maxPerDebt) / 1e6).toFixed(2)} USDC per debt, ${md.objectionWindowMs / 1000}s to object; allowance spent ${(Number(al.spent) / 1e6).toFixed(2)} of ${al.lifetimeCap === null ? '∞' : (Number(al.lifetimeCap) / 1e6).toFixed(2)} USDC, spender ${al.spender?.slice(0, 8)}…`,
    );
    if (al.spender !== dep.agent) bad(`allowance ${m.allowance} spender is not the Quits agent`);
  } catch (e) {
    bad(`Mandate ${m.mandate}: ${e instanceof Error ? e.message : e}`);
  }
}

// 4. Walrus Memory receipts
if (proof.memory) {
  try {
    const list = await listMemoryReceipts(graphql, proof.memory.owner, { agentId: proof.memory.agentId, namespacePrefix: 'quits:', max: 500 });
    const byNs = list.reduce<Record<string, number>>((a, r) => ((a[r.namespace?.split(':').slice(0, 2).join(':') ?? '?'] = (a[r.namespace?.split(':').slice(0, 2).join(':') ?? '?'] ?? 0) + 1), a), {});
    list.length >= 10
      ? ok(`${list.length} Walrus Memory memories on mainnet, owned by ${proof.memory.owner.slice(0, 10)}… and written by delegate ${proof.memory.agentId.slice(0, 10)}… (${Object.entries(byNs).map(([k, v]) => `${k} ${v}`).join(', ')})`)
      : bad(`only ${list.length} Walrus Memory memories found (need ≥ 10)`);
    const sample = list[0];
    if (sample) ok(`e.g. Blob ${scan('object', sample.objectId)}  ·  https://walruscan.com/mainnet/blob/${sample.blobId}`);
  } catch (e) {
    bad(`memory receipts: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exitCode = failed ? 1 : 0;
