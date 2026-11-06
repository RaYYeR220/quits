import type { ClientWithCoreApi } from '@mysten/sui/client';
import { LOCALNET_FAUCET_URL } from './config.ts';

/** Asks the local network's faucet for gas. */
export async function requestLocalGas(recipient: string, faucetUrl = LOCALNET_FAUCET_URL): Promise<void> {
  const res = await fetch(`${faucetUrl}/v2/gas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ FixedAmountRequest: { recipient } }),
  });
  if (!res.ok) throw new Error(`Faucet answered ${res.status}: ${await res.text()}`);
}

/** Total balance (coins plus address balance) of `coinType`, in base units. */
export async function totalBalance(client: ClientWithCoreApi, owner: string, coinType?: string): Promise<bigint> {
  const { balance } = await client.core.getBalance({ owner, ...(coinType ? { coinType } : {}) });
  return BigInt(balance.balance);
}

/** Polls until `owner` holds at least `min` of `coinType`. */
export async function waitForBalance(
  client: ClientWithCoreApi,
  owner: string,
  min: bigint,
  { coinType, timeoutMs = 20_000 }: { coinType?: string; timeoutMs?: number } = {},
): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const balance = await totalBalance(client, owner, coinType);
    if (balance >= min) return balance;
    if (Date.now() > deadline) throw new Error(`${owner} still holds ${balance} after ${timeoutMs} ms, wanted ${min}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
