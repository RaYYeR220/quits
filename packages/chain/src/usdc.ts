import type { ClientWithCoreApi } from '@mysten/sui/client';
import { GASLESS_FLOOR, formatUsdc } from '@quits/core';
import { Transaction } from '@mysten/sui/transactions';
import { USDC_MAINNET } from './config.ts';

type Amount = bigint | number;

/**
 * Pays `amount` of `coinType` from the sender's address balance:
 * `withdrawal → balance::redeem_funds → balance::send_funds`. Gas is resolved normally.
 */
export function sendFundsTx({ to, amount, coinType }: { to: string; amount: Amount; coinType: string }): Transaction {
  const tx = new Transaction();
  const funds = tx.moveCall({
    target: '0x2::balance::redeem_funds',
    typeArguments: [coinType],
    arguments: [tx.withdrawal({ amount: BigInt(amount), type: coinType })],
  });
  tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [coinType], arguments: [funds, tx.pure.address(to)] });
  return tx;
}

/**
 * Gasless stablecoin transfer: the same send-funds PTB with gas price 0 and no gas
 * payment, which Sui mainnet accepts for allowlisted stablecoins from 0.01 up.
 */
export function gaslessUsdcTx({ to, amount, usdcType = USDC_MAINNET }: { to: string; amount: Amount; usdcType?: string }): Transaction {
  const value = BigInt(amount);
  if (value < GASLESS_FLOOR) {
    throw new RangeError(`Gasless transfers start at ${formatUsdc(GASLESS_FLOOR)} USDC, got ${formatUsdc(value, 6)}`);
  }
  const tx = sendFundsTx({ to, amount: value, coinType: usdcType });
  tx.setGasPrice(0);
  tx.setGasBudget(0);
  tx.setGasPayment([]);
  return tx;
}

/**
 * A gasless transfer has no object inputs, so Sui requires a `ValidDuring`
 * expiration (at most two epochs) plus a nonce to keep it unique.
 */
export async function withValidDuring(tx: Transaction, client: ClientWithCoreApi): Promise<Transaction> {
  const [{ chainIdentifier }, { systemState }] = await Promise.all([client.core.getChainIdentifier(), client.core.getCurrentSystemState()]);
  const epoch = BigInt(systemState.epoch);
  tx.setExpiration({
    ValidDuring: {
      minEpoch: String(epoch),
      maxEpoch: String(epoch + 1n),
      minTimestamp: null,
      maxTimestamp: null,
      chain: chainIdentifier,
      nonce: (Math.random() * 4294967296) >>> 0,
    },
  });
  return tx;
}
