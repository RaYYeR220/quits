'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, call, store } from './api.ts';
import { SANDBOX_PREFIX } from './format.ts';
import type { GroupRef, MandateTerms, Me } from './types.ts';

export const DEMO_NAMES = ['Ana', 'Ben', 'Clara', 'Dan'] as const;
const TAB_KEY = 'quits.tabKey';

export type Net = 'localnet' | 'mainnet';

interface SessionValue {
  me: Me | null;
  state: 'loading' | 'ready' | 'anon' | 'error';
  net: Net;
  /** Bounds of every demo mandate; demo wallets also pay at most `maxPerDebt` per debt. */
  demoTerms: MandateTerms;
  tabKey: string | null;
  refresh: () => Promise<Me | null>;
  /** Start (or switch within) a demo session; keeps the visitor's own tab unless `fresh`. */
  startDemo: (name: string, opts?: { fresh?: boolean }) => Promise<{ tab: string; tabKey: string }>;
  signOut: () => Promise<void>;
  switching: string | null;
}

const Ctx = createContext<SessionValue | null>(null);

function keyFromPath(): string | null {
  if (typeof window === 'undefined') return null;
  const m = new RegExp(`/g/${SANDBOX_PREFIX}([a-z0-9]{8})`).exec(window.location.pathname);
  return m?.[1] ?? null;
}

export function SessionProvider({ children, net, demoTerms }: { children: React.ReactNode; net: Net; demoTerms: MandateTerms }) {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<SessionValue['state']>('loading');
  const [tabKey, setTabKey] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await call<Me>('/api/me');
      if (r.status === 401) {
        setMe(null);
        setState('anon');
        return null;
      }
      if (r.status >= 400 || !r.data) throw new Error(String(r.status));
      setMe(r.data);
      setState('ready');
      return r.data;
    } catch {
      setState('error');
      return null;
    }
  }, []);

  useEffect(() => {
    setTabKey(store.get<string>(TAB_KEY) ?? keyFromPath());
    void refresh();
  }, [refresh]);

  const startDemo = useCallback(
    async (name: string, opts: { fresh?: boolean } = {}) => {
      setSwitching(name);
      try {
        const prev = opts.fresh ? null : (store.get<string>(TAB_KEY) ?? keyFromPath());
        const r = await api<{ uid: string; name: string; tab: string; tabKey: string }>('/api/demo/session', {
          body: { as: name, ...(prev ? { tab: prev } : {}) },
        });
        store.set(TAB_KEY, r.tabKey);
        setTabKey(r.tabKey);
        await refresh();
        return { tab: r.tab, tabKey: r.tabKey };
      } finally {
        setSwitching(null);
      }
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await call('/api/auth/logout', { method: 'POST' }).catch(() => null);
    setMe(null);
    setState('anon');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ me, state, net, demoTerms, tabKey, refresh, startDemo, signOut, switching }),
    [me, state, net, demoTerms, tabKey, refresh, startDemo, signOut, switching],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Explorer links follow the network the app runs on (localnet while developing). */
export function useExplorer() {
  const { net } = useSession();
  return useMemo(
    () => ({
      tx: (digest: string) => `https://suiscan.xyz/${net}/tx/${digest}`,
      object: (id: string) => `https://suiscan.xyz/${net}/object/${id}`,
      account: (addr: string) => `https://suiscan.xyz/${net}/account/${addr}`,
    }),
    [net],
  );
}

/**
 * Groups to list. Demo members sit in every visitor's sandbox tab, so a demo
 * session only lists the shared demo groups plus this visitor's own tab.
 */
export function visibleGroups(me: Me | null, tabKey: string | null): GroupRef[] {
  if (!me) return [];
  if (!me.demo) return me.groups;
  const own = tabKey ? `${SANDBOX_PREFIX}${tabKey}` : null;
  const shown = me.groups.filter((g) => !g.id.startsWith(SANDBOX_PREFIX) || g.id === own);
  return shown.sort((a, b) => (a.id === own ? -1 : b.id === own ? 1 : 0));
}
