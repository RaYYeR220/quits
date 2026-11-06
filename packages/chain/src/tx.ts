import { SimulationError, type ClientWithCoreApi, type SuiClientTypes } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import type { Transaction } from '@mysten/sui/transactions';

export interface MoveAbortInfo {
  code: string;
  module?: string;
  function?: string;
  /** Name of the `#[error]` constant, when the package was built with clever errors. */
  constant?: string;
}

/** A transaction that did not succeed: rejected at build/simulation, or failed on-chain. */
export class ChainTxError extends Error {
  override name = 'ChainTxError';

  constructor(
    message: string,
    /** Set when the transaction was executed (and failed) on-chain. */
    readonly digest: string | null,
    readonly abort: MoveAbortInfo | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type ExecutedTx = SuiClientTypes.Transaction<{ effects: true; events: true; objectTypes: true; balanceChanges: true }>;

/** Signs, executes and waits for `tx`; throws `ChainTxError` unless it succeeded. */
export async function signAndExecute(client: ClientWithCoreApi, signer: Signer, tx: Transaction): Promise<ExecutedTx> {
  tx.setSenderIfNotSet(signer.toSuiAddress());
  let result: SuiClientTypes.TransactionResult<{ effects: true; events: true; objectTypes: true; balanceChanges: true }>;
  try {
    result = await client.core.signAndExecuteTransaction({
      transaction: tx,
      signer,
      include: { effects: true, events: true, objectTypes: true, balanceChanges: true },
    });
  } catch (err) {
    if (err instanceof SimulationError) {
      throw new ChainTxError(err.message, null, abortInfo(err.executionError), { cause: err });
    }
    throw err;
  }
  if (result.$kind === 'FailedTransaction') {
    const failed = result.FailedTransaction;
    const error = failed.status.success ? undefined : failed.status.error;
    throw new ChainTxError(`Transaction ${failed.digest} failed: ${error?.message ?? 'unknown error'}`, failed.digest, abortInfo(error));
  }
  await client.core.waitForTransaction({ digest: result.Transaction.digest });
  return result.Transaction;
}

export function abortInfo(error: SuiClientTypes.ExecutionError | undefined): MoveAbortInfo | null {
  if (!error || error.$kind !== 'MoveAbort') return null;
  const { abortCode, location, cleverError } = error.MoveAbort;
  return {
    code: abortCode,
    ...(location?.module ? { module: location.module } : {}),
    ...(location?.functionName ? { function: location.functionName } : {}),
    ...(cleverError?.constantName ? { constant: cleverError.constantName } : {}),
  };
}

/** Ids of objects the transaction created whose type matches `pattern`. */
export function createdObjects(tx: Pick<ExecutedTx, 'effects' | 'objectTypes'>, pattern: string | RegExp): string[] {
  return tx.effects.changedObjects
    .filter((o) => o.idOperation === 'Created')
    .map((o) => o.objectId)
    .filter((id) => {
      const type = tx.objectTypes[id] ?? '';
      return typeof pattern === 'string' ? type.includes(pattern) : pattern.test(type);
    });
}

export function createdObject(tx: Pick<ExecutedTx, 'effects' | 'objectTypes' | 'digest'>, pattern: string | RegExp): string {
  const [id] = createdObjects(tx, pattern);
  if (!id) throw new Error(`Transaction ${tx.digest} created no object matching ${String(pattern)}`);
  return id;
}
