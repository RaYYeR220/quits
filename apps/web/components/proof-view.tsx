'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api.ts';
import { ago, short, walrusUrl } from './format.ts';
import { useExplorer } from './session.tsx';
import type { DebtStatus, ProofData } from './types.ts';
import { ErrorBlock, ExtLink, LoadingBlock, Money } from './ui.tsx';

const FAILURE: Record<string, string> = {
  RESOURCE_EXHAUSTED: 'rate limited',
  '429': 'rate limited',
  UNAVAILABLE: 'unavailable',
  DEADLINE_EXCEEDED: 'timed out',
  INTERNAL: 'gateway error',
  UNKNOWN: 'unknown error',
  unknown: 'before error codes were logged',
};

const SURFACE: Record<string, string> = { grpc: 'Sui gRPC', graphql: 'Sui GraphQL', data: 'Data API' };
const SETTLED: Partial<Record<DebtStatus, string>> = { settled_wallet: 'wallet', settled_agent: 'agent', settled_external: 'direct' };

const clip = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n)}…` : s);

function nsLabel(ns: string): string {
  const g = /^quits:g:(.+):(rules|log)$/.exec(ns);
  if (g) return `${g[2] === 'rules' ? 'group rules' : 'group log'} · ${clip(g[1]!)}`;
  const m = /^quits:m:(.+)$/.exec(ns);
  if (m) return `member memory · ${clip(m[1]!)}`;
  return ns;
}

export function ProofView() {
  const ex = useExplorer();
  const [data, setData] = useState<ProofData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const d = await api<ProofData>('/api/proof');
      setData(d);
      setAt(Date.now());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, [load]);

  if (!data) {
    return (
      <div className="pt-12">
        {error ? <ErrorBlock message={error} onRetry={() => void load()} /> : <LoadingBlock label="Loading live receipts" rows={4} />}
      </div>
    );
  }

  const calls = data.tatum.byMethod.reduce((n, m) => n + m.n, 0);
  const ok = data.tatum.byMethod.reduce((n, m) => n + m.okN, 0);
  const net = data.network === 'localnet' ? 'localnet' : 'mainnet';
  const facts: [string, React.ReactNode][] = [
    ['Network', <span className="mono">sui:{net}</span>],
    ['Memory', data.memoryBackend === 'walrus' ? 'Walrus Memory' : 'Local stand-in'],
    [
      'Quits package',
      data.package ? (
        <ExtLink href={ex.object(data.package)} label={`Quits package ${data.package}`} className="text-[13px] whitespace-nowrap">
          {short(data.package, 8, 6)}
        </ExtLink>
      ) : (
        <span className="text-ink-3">not deployed</span>
      ),
    ],
    ['Memories stored', <span className="money">{data.memories.stored.toLocaleString('en-US')}</span>],
    ['Tatum calls', <span className="money">{calls.toLocaleString('en-US')}</span>],
    ['Settlements', <span className="money">{data.settlements.length}</span>],
  ];

  return (
    <div className="pt-8 md:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h-page">Public receipts</h1>
          <p className="lede mt-3">Every read through Tatum, every memory written to Walrus and every settlement on Sui, as it happens.</p>
        </div>
        <p className="meta" aria-live="polite">
          {error ? <span className="text-warn">Refresh failed · showing data from {ago(at ? new Date(at).toISOString() : null, now)}</span> : at ? `Updated ${ago(new Date(at).toISOString(), now)} · every 5 s` : ''}
        </p>
      </div>

      <section aria-label="Overview" className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-line bg-line md:grid-cols-3 lg:grid-cols-6">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3.5 sm:px-5">
            <p className="meta">{k}</p>
            <p className="mt-1 text-[15px] font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-labelledby="tatum-h" className="sheet p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="tatum-h" className="h-sec">
              Live Tatum calls
            </h2>
            <span className="meta">{calls ? `${Math.round((ok / calls) * 100)}% answered · last ${data.tatum.windowHours ?? 24} h` : 'none yet'}</span>
          </div>
          <p className="meta mt-2 max-w-[44em]">
            Answered: Tatum returned a result or a definite answer, such as &ldquo;not found yet&rdquo; while a transaction lands, or a simulation the chain rejects.
            {data.tatum.failures?.length
              ? ` Failed: ${data.tatum.failures.map((f) => `${f.n} × ${FAILURE[f.code] ?? f.code}`).join(', ')}.`
              : ' Nothing failed.'}
          </p>
          {data.tatum.byMethod.length === 0 ? (
            <p className="mt-4 text-[14px] text-ink-2">No calls recorded yet. Pay a debt or turn on auto-settle in the demo and they show up here.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="tbl min-w-[460px]">
                <thead>
                  <tr>
                    <th scope="col">Surface</th>
                    <th scope="col">Method</th>
                    <th scope="col" className="num">
                      Calls
                    </th>
                    <th scope="col" className="num">
                      Answered
                    </th>
                    <th scope="col" className="num">
                      Avg
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.tatum.byMethod.map((m) => {
                    const pct = m.n ? Math.round((m.okN / m.n) * 100) : 0;
                    return (
                      <tr key={`${m.surface}:${m.method}`}>
                        <td className="whitespace-nowrap text-ink-2">{SURFACE[m.surface] ?? m.surface}</td>
                        <td className="mono text-[12.5px]">
                          {m.method.includes('.') ? (
                            <>
                              <span className="block">{m.method.slice(m.method.lastIndexOf('.') + 1)}</span>
                              <span className="block text-[11px] text-ink-3">{m.method.slice(0, m.method.lastIndexOf('.'))}</span>
                            </>
                          ) : (
                            <span className="break-all">{m.method}</span>
                          )}
                        </td>
                        <td className="num whitespace-nowrap">{m.n.toLocaleString('en-US')}</td>
                        <td className={`num whitespace-nowrap ${pct < 100 ? 'text-warn' : ''}`}>{pct}%</td>
                        <td className="num whitespace-nowrap text-ink-2">{m.avgMs >= 10_000 ? `${Math.round(m.avgMs / 1000)} s` : `${m.avgMs} ms`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data.tatum.recent.length ? (
            <>
              <h3 className="mt-6 text-[13.5px] font-semibold text-ink-2">Latest calls</h3>
              <ul className="mono mt-2 flex flex-col gap-1.5 text-[11.5px]">
                {data.tatum.recent.slice(0, 8).map((c) => (
                  <li key={c.id} className="grid grid-cols-[14px_1fr_auto] items-baseline gap-2">
                    <span aria-label={c.ok ? 'ok' : 'failed'} className={c.ok ? 'text-ink-3' : 'text-warn'}>
                      {c.ok ? '✓' : '×'}
                    </span>
                    <span className="truncate text-ink-2">{c.method}</span>
                    <span className="text-ink-3">
                      {c.ms >= 10_000 ? `${Math.round(c.ms / 1000)} s` : `${c.ms} ms`} · {ago(c.at, now)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section aria-labelledby="settle-h" className="sheet p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="settle-h" className="h-sec">
              Settlements on Sui
            </h2>
            <span className="meta">USDC · x402</span>
          </div>
          {data.settlements.length === 0 ? (
            <p className="mt-4 text-[14px] text-ink-2">No debts settled yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {data.settlements.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <ExtLink href={s.explorer || ex.tx(s.digest)} className="text-[12.5px]" label={`Transaction ${s.digest}`}>
                      {short(s.digest, 8, 6)}
                    </ExtLink>
                    <span className="meta mt-0.5 block">
                      {SETTLED[s.status] ? `paid by ${SETTLED[s.status]}` : s.status} · {ago(s.at, now)}
                    </span>
                  </span>
                  <Money micro={s.usdcMicro} unit className="text-[14px]" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {data.onchainMemory ? (
        <section aria-labelledby="chain-mem-h" className="sheet mt-6 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="chain-mem-h" className="h-sec">
              Memory receipts on Sui
            </h2>
            {'error' in data.onchainMemory ? null : (
              <span className="meta">
                {data.onchainMemory.count.toLocaleString('en-US')} Walrus Blob objects owned by{' '}
                <ExtLink href={ex.account(data.onchainMemory.owner)}>{short(data.onchainMemory.owner)}</ExtLink>
              </span>
            )}
          </div>
          {'error' in data.onchainMemory ? (
            <p className="notice notice-warn mt-4">Couldn’t read the blob objects from chain just now: {data.onchainMemory.error}</p>
          ) : (
            <>
              <p className="mt-1.5 text-[14px] text-ink-2">Every memory is a Walrus blob with a Sui object behind it, tagged with the Quits agent id. Read from chain through Tatum.</p>
              <div className="mt-4 overflow-x-auto">
                <table className="tbl min-w-[560px]">
                  <thead>
                    <tr>
                      <th scope="col">Object</th>
                      <th scope="col">Walrus blob</th>
                      <th scope="col">Namespace</th>
                      <th scope="col" className="num">
                        Until epoch
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.onchainMemory.latest.map((r) => (
                      <tr key={r.objectId}>
                        <td>
                          <ExtLink href={r.suiscan || ex.object(r.objectId)} className="text-[12px]">
                            {short(r.objectId, 8, 6)}
                          </ExtLink>
                        </td>
                        <td>
                          {walrusUrl(r.blobId) ? (
                            <ExtLink href={walrusUrl(r.blobId)!} className="text-[12px]">
                              {short(r.blobId, 8, 6)}
                            </ExtLink>
                          ) : (
                            <span className="mono text-[12px]">{short(r.blobId, 8, 6)}</span>
                          )}
                        </td>
                        <td className="mono text-[12px] text-ink-2">{r.namespace ? nsLabel(r.namespace) : '—'}</td>
                        <td className="num text-ink-2">{r.endEpoch ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby="mem-h" className="sheet mt-6 p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="mem-h" className="h-sec">
            Latest memories on Walrus
          </h2>
          <span className="meta">{data.memories.stored.toLocaleString('en-US')} stored</span>
        </div>
        {data.memories.latest.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-2">Nothing written yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.memories.latest.slice(0, 16).map((m, i) => {
              const url = m.walruscan && walrusUrl(m.blobId) ? m.walruscan : null;
              return (
                <li key={`${m.blobId ?? i}-${m.storedAt}`} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className={`text-[14px] leading-[1.45] ${m.kind === 'rule' ? 'text-ink' : 'text-ink-2'}`}>
                      {m.kind === 'rule' ? <span aria-hidden="true" className="mr-2 inline-block h-[3px] w-2.5 rounded-full bg-mem align-middle" /> : null}
                      {m.text}
                    </p>
                    <p className="mono mt-1 text-[11.5px] text-ink-3">
                      {m.kind} · {nsLabel(m.ns)}
                    </p>
                  </div>
                  <div className="mono flex items-center gap-3 text-[11.5px] text-ink-3 sm:flex-col sm:items-end sm:gap-1">
                    {url ? (
                      <ExtLink href={url} label={`Walrus blob ${m.blobId}`}>
                        {short(m.blobId, 8, 6)}
                      </ExtLink>
                    ) : m.blobId ? (
                      <span title="Kept by the local memory stand-in; no public Walrus page">{m.blobId}</span>
                    ) : null}
                    <span>{ago(m.storedAt, now)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
