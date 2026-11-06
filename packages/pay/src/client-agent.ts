import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { toBase64 } from '@mysten/sui/utils';
import { settleTx, type QuitsChainConfig } from '@quits/chain';
import { signBuilt } from './client-wallet.ts';
import { encodePaymentHeader, exactSuiOption, type X402Requirements } from './x402.ts';

/**
 * The agent's payment for an on-chain debt: a signed `quits::settle::settle`
 * call that pulls the amount from the debtor's allowance. Returns the
 * `PAYMENT-SIGNATURE` header value. Throws `ChainTxError` if the contract
 * would refuse (e.g. `EInObjectionWindow`).
 */
export async function buildAgentPayment(
  agentSigner: Signer,
  cfg: QuitsChainConfig,
  args: { mandateId: string; debtId: string; allowanceId: string; funder: string; amount: bigint },
  { client, requirements }: { client: ClientWithCoreApi; requirements?: X402Requirements },
): Promise<string> {
  const tx = settleTx(cfg, args);
  tx.setSender(agentSigner.toSuiAddress());
  const { bytes, signature } = await signBuilt(tx, agentSigner, client);
  return encodePaymentHeader({
    x402Version: 2,
    ...(requirements ? { resource: requirements.resource, accepted: exactSuiOption(requirements) } : {}),
    payload: { signature, transaction: toBase64(bytes) },
  });
}
