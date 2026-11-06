import { SimulationError, type ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { ChainTxError, abortInfo, gaslessUsdcTx, sendFundsTx, withValidDuring } from '@quits/chain';
import { encodePaymentHeader, exactSuiOption, type X402Requirements } from './x402.ts';

/**
 * Signs (does not submit) the payment a 402 asks for and returns the
 * `PAYMENT-SIGNATURE` header value. On mainnet the transfer is gasless.
 */
export async function buildWalletPayment(
  signer: Signer,
  req: X402Requirements,
  { client, gasless }: { client: ClientWithCoreApi; gasless?: boolean },
): Promise<string> {
  const accepted = exactSuiOption(req);
  const transfer = { to: accepted.payTo, amount: BigInt(accepted.amount) };
  const isGasless = gasless ?? accepted.network === 'sui:mainnet';
  const tx = isGasless ? gaslessUsdcTx({ ...transfer, usdcType: accepted.asset }) : sendFundsTx({ ...transfer, coinType: accepted.asset });
  tx.setSender(signer.toSuiAddress());
  if (isGasless) await withValidDuring(tx, client);
  const { bytes, signature } = await signBuilt(tx, signer, client);
  return encodePaymentHeader({ x402Version: 2, resource: req.resource, accepted, payload: { signature, transaction: toBase64(bytes) } });
}

/** Builds and signs; a transaction the chain would reject surfaces as `ChainTxError`. */
export async function signBuilt(tx: Transaction, signer: Signer, client: ClientWithCoreApi): Promise<{ bytes: Uint8Array; signature: string }> {
  let bytes: Uint8Array;
  try {
    bytes = await tx.build({ client });
  } catch (err) {
    if (err instanceof SimulationError) throw new ChainTxError(err.message, null, abortInfo(err.executionError), { cause: err });
    throw err;
  }
  const { signature } = await signer.signTransaction(bytes);
  return { bytes, signature };
}
