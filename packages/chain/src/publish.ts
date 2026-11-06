import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Signer } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { createdObject, signAndExecute } from './tx.ts';

const run = promisify(execFile);

export interface BuiltPackage {
  modules: string[];
  dependencies: string[];
}

/** Compiles a Move package with the Sui CLI (`sui move build --dump-bytecode-as-base64`). */
export async function buildMovePackage(path: string, { suiBin = 'sui', env = 'testnet' }: { suiBin?: string; env?: string } = {}): Promise<BuiltPackage> {
  const { stdout } = await run(suiBin, ['move', 'build', '--dump-bytecode-as-base64', '--path', path, '-e', env], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('{'));
  if (!line) throw new Error(`sui move build printed no bytecode for ${path}`);
  const built = JSON.parse(line) as BuiltPackage;
  return { modules: built.modules, dependencies: built.dependencies };
}

export interface PublishedQuits {
  pkg: string;
  configId: string;
  adminCapId: string;
  upgradeCapId: string;
  digest: string;
}

/** Publishes the `quits` package; the signer receives the AdminCap and UpgradeCap. */
export async function publishQuits(client: ClientWithCoreApi, signer: Signer, built: BuiltPackage): Promise<PublishedQuits> {
  const tx = new Transaction();
  const upgradeCap = tx.publish({ modules: built.modules, dependencies: built.dependencies });
  tx.transferObjects([upgradeCap], signer.toSuiAddress());
  const res = await signAndExecute(client, signer, tx);
  const pkg = res.effects.changedObjects.find((o) => o.outputState === 'PackageWrite')?.objectId;
  if (!pkg) throw new Error(`Publish ${res.digest} wrote no package`);
  return {
    pkg,
    configId: createdObject(res, '::settle::Config'),
    adminCapId: createdObject(res, '::settle::AdminCap'),
    upgradeCapId: createdObject(res, '::package::UpgradeCap'),
    digest: res.digest,
  };
}
