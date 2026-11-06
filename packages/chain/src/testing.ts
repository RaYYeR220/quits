import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_TYPE, type QuitsChainConfig } from './config.ts';
import { requestLocalGas, waitForBalance } from './localnet.ts';
import { openMandateTx, recordDebtTx, setRolesTx } from './move.ts';
import { buildMovePackage, publishQuits } from './publish.ts';
import { createTatumSui } from './tatum-grpc.ts';
import { createdObject, signAndExecute } from './tx.ts';

export { requestLocalGas, totalBalance, waitForBalance } from './localnet.ts';

const MOVE_PACKAGE = fileURLToPath(new URL('../../../move/quits', import.meta.url));

/** A freshly published `quits` package on localnet, with SUI standing in for USDC. */
export interface LocalQuits {
  client: SuiGrpcClient;
  cfg: QuitsChainConfig;
  adminCapId: string;
  /** Publisher and registrar. */
  operator: Ed25519Keypair;
  agent: Ed25519Keypair;
  ana: Ed25519Keypair;
  ben: Ed25519Keypair;
}

/**
 * Funds four new keypairs from the faucet, builds and publishes the Move package
 * (`SUI_BIN` points at the Sui CLI), sets the roles and gives Ana and Ben SUI in
 * their address balances.
 */
export async function startLocalQuits({ addressBalance = 5_000_000_000n }: { addressBalance?: bigint } = {}): Promise<LocalQuits> {
  const { client } = createTatumSui({ network: 'localnet', rpcUrl: process.env.SUI_LOCALNET_RPC });
  const operator = Ed25519Keypair.generate();
  const agent = Ed25519Keypair.generate();
  const ana = Ed25519Keypair.generate();
  const ben = Ed25519Keypair.generate();
  const everyone = [operator, agent, ana, ben];
  for (const k of everyone) await requestLocalGas(k.toSuiAddress(), process.env.SUI_LOCALNET_FAUCET);
  await Promise.all(everyone.map((k) => waitForBalance(client, k.toSuiAddress(), 1n)));

  const built = await buildMovePackage(await copyMovePackage(), { suiBin: process.env.SUI_BIN ?? 'sui' });
  const published = await publishQuits(client, operator, built);
  const cfg: QuitsChainConfig = { pkg: published.pkg, configId: published.configId, usdcType: SUI_TYPE };
  await signAndExecute(
    client,
    operator,
    setRolesTx(cfg, { adminCapId: published.adminCapId, registrar: operator.toSuiAddress(), agent: agent.toSuiAddress() }),
  );
  for (const member of [ana, ben]) await depositToAddressBalance(client, member, addressBalance);

  return { client, cfg, adminCapId: published.adminCapId, operator, agent, ana, ben };
}

/** Moves SUI from the signer's coins into their address balance. */
export async function depositToAddressBalance(client: ClientWithCoreApi, signer: Ed25519Keypair, amount: bigint): Promise<void> {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [amount]);
  tx.moveCall({ target: '0x2::coin::send_funds', typeArguments: [SUI_TYPE], arguments: [coin, tx.pure.address(signer.toSuiAddress())] });
  await signAndExecute(client, signer, tx);
}

export async function openLocalMandate(
  q: LocalQuits,
  funder: Ed25519Keypair,
  o: {
    creditors: string[];
    maxPerDebt: bigint;
    lifetimeCap?: bigint | null;
    weeklyLimit?: bigint | null;
    objectionWindowMs?: number;
    group?: string;
  },
): Promise<{ mandateId: string; allowanceId: string; digest: string }> {
  const res = await signAndExecute(
    q.client,
    funder,
    openMandateTx(q.cfg, {
      group: o.group ?? 'flat-5b',
      agent: q.agent.toSuiAddress(),
      lifetimeCap: o.lifetimeCap === undefined ? 3_000_000_000n : o.lifetimeCap,
      weeklyLimit: o.weeklyLimit === undefined ? 2_000_000_000n : o.weeklyLimit,
      expiresAtMs: Date.now() + 30 * 24 * 3600_000,
      creditors: o.creditors,
      maxPerDebt: o.maxPerDebt,
      objectionWindowMs: o.objectionWindowMs ?? 0,
    }),
  );
  return {
    mandateId: createdObject(res, '::settle::Mandate'),
    allowanceId: createdObject(res, '::allowance::Allowance<'),
    digest: res.digest,
  };
}

export async function recordLocalDebt(
  q: LocalQuits,
  a: { mandateId: string; reference: string; creditor: string; amount: bigint },
): Promise<string> {
  const res = await signAndExecute(q.client, q.operator, recordDebtTx(q.cfg, a));
  return createdObject(res, '::settle::Debt<');
}

/** Builds from a temp copy so the repo's Move package stays untouched. */
async function copyMovePackage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'quits-move-'));
  for (const entry of ['Move.toml', 'Move.lock', 'sources']) {
    await cp(join(MOVE_PACKAGE, entry), join(dir, entry), { recursive: true });
  }
  return dir;
}
