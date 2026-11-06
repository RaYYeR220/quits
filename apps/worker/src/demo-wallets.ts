import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { gaslessUsdcTx, signAndExecute, withValidDuring } from '@quits/chain';

/**
 * Demo payments only move USDC between the four demo flatmates, so the money
 * pools with whoever is owed most. This tops up the poorest wallet from the
 * richest (a gasless transfer) so every visitor can pay as any member.
 */
export async function rebalanceDemoWallets(
  client: ClientWithCoreApi,
  wallets: Ed25519Keypair[],
  usdcType: string,
  { floor = 300_000n, target = 450_000n }: { floor?: bigint; target?: bigint } = {},
): Promise<{ moved: bigint; from?: string; to?: string; digest?: string }> {
  const balances = await Promise.all(
    wallets.map(async (w) => ({ w, usdc: BigInt((await client.core.getBalance({ owner: w.toSuiAddress(), coinType: usdcType })).balance.addressBalance ?? '0') })),
  );
  balances.sort((a, b) => (a.usdc < b.usdc ? -1 : a.usdc > b.usdc ? 1 : 0));
  const poorest = balances[0];
  const richest = balances[balances.length - 1];
  if (!poorest || !richest || poorest.usdc >= floor) return { moved: 0n };
  const need = target - poorest.usdc;
  const spare = richest.usdc - target;
  const amount = need < spare ? need : spare;
  if (amount < 10_000n) return { moved: 0n };
  const tx = gaslessUsdcTx({ to: poorest.w.toSuiAddress(), amount, usdcType });
  tx.setSender(richest.w.toSuiAddress());
  await withValidDuring(tx, client);
  const res = await signAndExecute(client, richest.w, tx);
  return { moved: amount, from: richest.w.toSuiAddress(), to: poorest.w.toSuiAddress(), digest: res.digest };
}
