// Publishes quits::settle to Sui mainnet through Tatum's gRPC gateway and assigns roles.
//   TATUM_API_KEY=... QUITS_OPERATOR_KEY=... QUITS_AGENT_KEY=... SUI_BIN=... tsx scripts/mainnet-deploy.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildMovePackage, createTatumSui, publishQuits, setRolesTx, signAndExecute, USDC_MAINNET } from '@quits/chain';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};
const operator = Ed25519Keypair.fromSecretKey(need('QUITS_OPERATOR_KEY'));
const agent = Ed25519Keypair.fromSecretKey(need('QUITS_AGENT_KEY'));
const { client } = createTatumSui({ apiKey: need('TATUM_API_KEY'), network: 'mainnet' });

const gas = await client.core.getBalance({ owner: operator.toSuiAddress() });
console.log('operator', operator.toSuiAddress(), 'SUI', gas.balance.balance);

const built = await buildMovePackage('move/quits', { suiBin: process.env.SUI_BIN ?? 'sui', env: 'mainnet' });
const pub = await publishQuits(client, operator, built);
console.log('published', pub);
const roles = await signAndExecute(
  client,
  operator,
  setRolesTx({ pkg: pub.pkg, configId: pub.configId, usdcType: USDC_MAINNET }, { adminCapId: pub.adminCapId, registrar: operator.toSuiAddress(), agent: agent.toSuiAddress() }),
);

const out = {
  network: 'mainnet',
  package: pub.pkg,
  config: pub.configId,
  adminCap: pub.adminCapId,
  upgradeCap: pub.upgradeCapId,
  publishTx: pub.digest,
  rolesTx: roles.digest,
  registrar: operator.toSuiAddress(),
  agent: agent.toSuiAddress(),
  usdc: USDC_MAINNET,
  publishedAt: new Date().toISOString(),
};
mkdirSync('deployments', { recursive: true });
writeFileSync('deployments/mainnet.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(out);
