// Publishes Quits to a local Sui network, assigns roles and funds the demo wallets.
// Prints the env block for apps/web/.env.local and the worker.
//   SUI_BIN=.../sui.exe tsx scripts/localnet-up.ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { buildMovePackage, publishQuits, requestLocalGas, setRolesTx, signAndExecute, SUI_TYPE, totalBalance } from '@quits/chain';
import { depositToAddressBalance } from '@quits/chain/testing';

const key = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return Ed25519Keypair.fromSecretKey(v);
};

const client = new SuiGrpcClient({ network: 'localnet', baseUrl: process.env.SUI_LOCALNET_RPC ?? 'http://127.0.0.1:9000' });
const operator = key('QUITS_OPERATOR_KEY');
const agent = key('QUITS_AGENT_KEY');
const demo = ['ANA', 'BEN', 'CLARA', 'DAN'].map((m) => [m, key(`QUITS_DEMO_${m}_KEY`)] as const);

for (const k of [operator, agent, ...demo.map(([, k]) => k)]) await requestLocalGas(k.toSuiAddress());
await new Promise((r) => setTimeout(r, 2500));

const built = await buildMovePackage('move/quits', { suiBin: process.env.SUI_BIN ?? 'sui' });
const pub = await publishQuits(client, operator, built);
await signAndExecute(client, operator, setRolesTx({ pkg: pub.pkg, configId: pub.configId, usdcType: SUI_TYPE }, { adminCapId: pub.adminCapId, registrar: operator.toSuiAddress(), agent: agent.toSuiAddress() }));

// Allowance pulls draw from address balances, so park some SUI there for each demo member.
for (const [, k] of demo) await depositToAddressBalance(client, k, 20_000_000_000n);

console.log(`SUI_NETWORK=localnet
QUITS_PACKAGE_ID=${pub.pkg}
QUITS_CONFIG_ID=${pub.configId}
QUITS_ADMIN_CAP_ID=${pub.adminCapId}`);
for (const [m, k] of demo) console.error(`${m} ${k.toSuiAddress()} ${await totalBalance(client, k.toSuiAddress(), SUI_TYPE)}`);
