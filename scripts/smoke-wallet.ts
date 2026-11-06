// End-to-end test of the real-member path on mainnet: two fresh wallets sign in by
// signature, open a group, split a bill, the debtor pays from their own wallet over
// x402 and turns on auto-settle with a mandate they sign themselves.
//
//   QUITS_WEB_URL=https://quits-eight.vercel.app \
//   QUITS_SMOKE_USDC_KEY=suiprivkey…   (pays the debtor's 0.06 USDC, gasless) \
//   QUITS_SMOKE_GAS_KEY=suiprivkey…    (sends the debtor 0.02 SUI for the mandate) \
//   tsx scripts/smoke-wallet.ts
//
// Leftover USDC is swept back to the USDC key at the end.
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fromBase64 } from '@mysten/sui/utils';
import { gaslessUsdcTx, signAndExecute, withValidDuring } from '@quits/chain';

const base = (process.env.QUITS_WEB_URL ?? 'http://localhost:3100').replace(/\/$/, '');
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
const usdcKey = Ed25519Keypair.fromSecretKey(need('QUITS_SMOKE_USDC_KEY'));
const gasKey = Ed25519Keypair.fromSecretKey(need('QUITS_SMOKE_GAS_KEY'));

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function step(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

class Member {
  cookie = '';
  constructor(readonly name: string, readonly key = new Ed25519Keypair()) {}
  get address() {
    return this.key.toSuiAddress();
  }
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data };
  }
  async signIn() {
    const ch = await this.call('POST', '/api/auth/challenge', {});
    const { signature } = await this.key.signPersonalMessage(new TextEncoder().encode(ch.data.message));
    return this.call('POST', '/api/auth/verify', { address: this.address, signature, message: ch.data.message, provider: 'wallet', name: this.name });
  }
  async sign(txBytes: string) {
    return this.key.signTransaction(fromBase64(txBytes));
  }
}

async function usdcOf(address: string) {
  const { balance } = await client.core.getBalance({ owner: address, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' });
  return BigInt(balance.addressBalance ?? balance.balance);
}

async function gasless(from: Ed25519Keypair, to: string, amount: bigint) {
  const tx = gaslessUsdcTx({ to, amount });
  tx.setSender(from.toSuiAddress());
  await withValidDuring(tx, client);
  return signAndExecute(client, from, tx);
}

const t0 = Date.now();
const avery = new Member('Avery');
const blake = new Member('Blake');
console.log(`creditor ${avery.address}\ndebtor   ${blake.address}`);

const fund = await gasless(usdcKey, blake.address, 60_000n);
step('debtor gets 0.06 USDC (gasless)', Boolean(fund.digest), fund.digest);
const gas = new Transaction();
gas.transferObjects([gas.splitCoins(gas.gas, [20_000_000n])], blake.address);
const gasTx = await signAndExecute(client, gasKey, gas);
step('debtor gets 0.02 SUI for the mandate', Boolean(gasTx.digest), gasTx.digest);

for (const m of [avery, blake]) {
  const r = await m.signIn();
  step(`${m.name} signs in with a wallet signature`, r.status === 200 && Boolean(r.data.uid), r.data);
}
const mallory = new Member('Mallory');
const fresh = await mallory.call('POST', '/api/auth/challenge', {});
const wrongKey = await blake.key.signPersonalMessage(new TextEncoder().encode(fresh.data.message));
const forged = await mallory.call('POST', '/api/auth/verify', { address: avery.address, signature: wrongKey.signature, message: fresh.data.message });
step("signing in as someone else's address is refused", forged.status === 401 && /did not verify/.test(forged.data.error), forged.data);

const g = await avery.call('POST', '/api/groups', { name: 'Wallet check', currency: 'USDC' });
step('creditor opens a group', g.status === 200 && Boolean(g.data.id), g.data);
const groupId = g.data.id as string;
const list = await avery.call('GET', '/api/groups');
const code = list.data.groups?.find((x: any) => x.id === groupId)?.code as string;
const join = await blake.call('POST', '/api/groups/join', { code });
step('debtor joins by invite code', join.status === 200 && join.data.id === groupId, join.data);

const add = await avery.call('POST', `/api/groups/${groupId}/expenses`, { text: 'Coffee 0.10 USDC, I paid, split evenly with Blake' });
step('creditor adds a bill in plain words', add.status === 200 && add.data.ok, add.data.proposal?.shares ?? add.data);
const acc = await avery.call('POST', `/api/expenses/${add.data.proposal?.draftId}/accept`);
step('accept', acc.status === 200, { debts: acc.data.debts?.length });

const view = await blake.call('GET', `/api/groups/${groupId}`);
const me = view.data.members?.find((m: any) => m.suiAddress === blake.address);
const debt = view.data.debts?.find((d: any) => d.status === 'open' && d.debtorId === me?.id);
step('debtor owes the creditor 0.05 USDC', debt?.usdcMicro === '50000' || debt?.usdcMicro === 50000, debt);

const before = await usdcOf(avery.address);
const ask = await blake.call('GET', `/api/pay/${debt.id}`);
step('debt answers 402 with exact on sui:mainnet', ask.status === 402 && ask.data.accepts?.[0]?.network === 'sui:mainnet', ask.data.accepts?.[0]);
const prep = await blake.call('POST', `/api/pay/${debt.id}/prepare`, {});
step('server builds the transfer for the wallet to sign', prep.status === 200 && Boolean(prep.data.txBytes), { to: prep.data.to, amount: prep.data.amount });
const stranger = await avery.call('POST', `/api/pay/${debt.id}/prepare`, {});
step('only the debtor can prepare the payment', stranger.status === 403, stranger.data);
const signed = await blake.sign(prep.data.txBytes);
const header = Buffer.from(JSON.stringify({ x402Version: 2, payload: { signature: signed.signature, transaction: signed.bytes } })).toString('base64');
const pay = await blake.call('GET', `/api/pay/${debt.id}`, undefined, { 'PAYMENT-SIGNATURE': header });
step('debtor pays from their own wallet over x402', pay.status === 200 && pay.data.settled, pay.data);
const replay = await blake.call('GET', `/api/pay/${debt.id}`, undefined, { 'PAYMENT-SIGNATURE': header });
step('replaying the same payment returns the same receipt', replay.status === 200 && replay.data.digest === pay.data.digest, replay.data.digest);
const after = await usdcOf(avery.address);
step('creditor received exactly 0.05 USDC on mainnet', after - before === 50_000n, { before: String(before), after: String(after) });

const mp = await blake.call('POST', `/api/groups/${groupId}/autosettle`, { step: 'prepare', maxPerDebt: '1000000', weeklyLimit: '2000000', lifetimeCap: '3000000', objectionWindowMs: 3_600_000, days: 7 });
step('server builds the mandate for the wallet to sign', mp.status === 200 && Boolean(mp.data.txBytes), mp.data.terms ?? mp.data);
const ms = await blake.sign(mp.data.txBytes);
const mc = await blake.call('POST', `/api/groups/${groupId}/autosettle`, { step: 'confirm', txBytes: ms.bytes, signature: ms.signature, maxPerDebt: '1000000', weeklyLimit: '2000000', lifetimeCap: '3000000', objectionWindowMs: 3_600_000, days: 7 });
step('debtor signs the mandate; it opens on mainnet', mc.status === 200 && Boolean(mc.data.mandateObjectId), mc.data);

// hand the debtor's leftover SUI back to the gas key
const back = new Transaction();
back.transferObjects([back.gas], gasKey.toSuiAddress());
await signAndExecute(client, blake.key, back);

for (const m of [avery, blake]) {
  const left = await usdcOf(m.address);
  if (left >= 10_000n) {
    const back = await gasless(m.key, usdcKey.toSuiAddress(), left);
    console.log(`swept ${left} micro-USDC from ${m.name} back (${back.digest})`);
  }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
