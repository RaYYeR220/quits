'use client';

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { createDAppKit, type UiWallet } from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { api, errorText } from './api.ts';

type Kit = ReturnType<typeof makeKit>;

function makeKit() {
  return createDAppKit({
    networks: ['mainnet'],
    defaultNetwork: 'mainnet',
    autoConnect: true,
    slushWalletConfig: { appName: 'Quits' },
    createClient: (network) => new SuiGrpcClient({ network, baseUrl: 'https://fullnode.mainnet.sui.io:443' }),
  });
}

const KitCtx = createContext<Kit | null>(null);

/** Wallet standard + Slush, created in the browser only (wallets register on window). */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [kit, setKit] = useState<Kit | null>(null);
  useEffect(() => setKit(makeKit()), []);
  return <KitCtx.Provider value={kit}>{children}</KitCtx.Provider>;
}

const noop = () => () => {};

function useAtom<T>(atom: { get(): T; subscribe(cb: () => void): () => void } | undefined, fallback: T): T {
  return useSyncExternalStore(atom ? (cb) => atom.subscribe(cb) : noop, atom ? () => atom.get() : () => fallback, () => fallback);
}

export function useWallet() {
  const kit = useContext(KitCtx);
  const wallets = useAtom(kit?.stores.$wallets, [] as UiWallet[]);
  const connection = useAtom(kit?.stores.$connection, null as null | { account: { address: string } | null; status: string });
  const address = connection?.account?.address ?? null;

  /** Signs transaction bytes the server built; returns what an x402 payment carries. */
  const signTxBytes = useCallback(
    async (txBytesB64: string) => {
      if (!kit) throw new Error('Wallets are still loading.');
      const r = await kit.signTransaction({ transaction: Transaction.from(txBytesB64) });
      return { transaction: r.bytes, signature: r.signature };
    },
    [kit],
  );

  return { ready: Boolean(kit), kit, wallets, address, signTxBytes };
}

/** Connect a Sui wallet and sign the one-time message; the server checks the signature. */
export function WalletSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { ready, kit, wallets, address } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(wallet: UiWallet) {
    if (!kit) return;
    setBusy(wallet.name);
    setError(null);
    try {
      const { accounts } = await kit.connectWallet({ wallet });
      const account = accounts[0];
      if (!account) throw new Error('The wallet shared no account.');
      const ch = await api<{ message: string }>('/api/auth/challenge', { body: {} });
      const signed = await kit.signPersonalMessage({ message: new TextEncoder().encode(ch.message), account });
      await api('/api/auth/verify', { body: { address: account.address, signature: signed.signature, message: ch.message, provider: 'wallet' } });
      onSignedIn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return <p className="meta">Looking for wallets…</p>;
  return (
    <div className="flex flex-col gap-2">
      {wallets.length === 0 ? (
        <p className="text-[14px] text-ink-2">
          No Sui wallet found in this browser.{' '}
          <a className="link" href="https://slush.app" target="_blank" rel="noreferrer">
            Get Slush
          </a>{' '}
          and come back.
        </p>
      ) : (
        wallets.map((w) => (
          <button key={w.name} type="button" className="btn btn-ghost justify-start gap-3" disabled={busy !== null} onClick={() => void signIn(w)}>
            {w.icon ? <img src={w.icon} alt="" width={20} height={20} className="rounded-[5px]" /> : null}
            {busy === w.name ? 'Check your wallet…' : `Sign in with ${w.name}`}
          </button>
        ))
      )}
      {address ? <p className="meta mono">connected {address.slice(0, 8)}…{address.slice(-4)}</p> : null}
      {error ? <p className="notice notice-warn" role="alert">{error}</p> : null}
    </div>
  );
}
