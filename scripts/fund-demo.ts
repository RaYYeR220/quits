// Tops up the demo members' wallets on mainnet from the operator: USDC into their
// address balance (so their payments are gasless) and a little SUI for opening mandates.
//   TATUM_API_KEY=... QUITS_OPERATOR_KEY=... QUITS_DEMO_*_KEY=... tsx scripts/fund-demo.ts [usdcEach=2] [suiEach=0.05]
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { createTatumSui, signAndExecute, USDC_MAINNET } from '@quits/chain';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const usdcEach = BigInt(Math.round(Number(process.argv[2] ?? '2') * 1e6));
const suiEach = BigInt(Math.round(Number(process.argv[3] ?? '0.05') * 1e9));
const operator = Ed25519Keypair.fromSecretKey(need('QUITS_OPERATOR_KEY'));
const members = ['ANA', 'BEN', 'CLARA', 'DAN'].map((m) => Ed25519Keypair.fromSecretKey(need(`QUITS_DEMO_${m}_KEY`)).toSuiAddress());
const { client } = createTatumSui({ apiKey: need('TATUM_API_KEY'), network: 'mainnet' });

const tx = new Transaction();
for (const to of members) {
  if (usdcEach > 0n) {
    const usdc = tx.balance({ type: USDC_MAINNET, balance: usdcEach });
    tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [USDC_MAINNET], arguments: [usdc, tx.pure.address(to)] });
  }
  if (suiEach > 0n) {
    const [coin] = tx.splitCoins(tx.gas, [suiEach]);
    tx.transferObjects([coin!], to);
  }
}
const res = await signAndExecute(client, operator, tx);
console.log('funded', members.length, 'members', { usdcEach: usdcEach.toString(), suiEach: suiEach.toString(), digest: res.digest });
for (const a of members) {
  const [u, s] = await Promise.all([client.core.getBalance({ owner: a, coinType: USDC_MAINNET }), client.core.getBalance({ owner: a })]);
  console.log(a, 'USDC', u.balance.balance, 'SUI', s.balance.balance);
}
