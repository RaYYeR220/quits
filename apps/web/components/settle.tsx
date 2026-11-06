'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from './wallet.tsx';
import { api, call, errorText, store } from './api.ts';
import { short, toMicro, usdc, usdcFull } from './format.ts';
import { useExplorer, useSession } from './session.tsx';
import type { Debt, DebtStatus, DemoPay, GroupData, ProofData, Receipt, X402Requirements } from './types.ts';
import { Avatar, ExtLink, Money, mmss, useCountdown } from './ui.tsx';

const SETTLED_LABEL: Partial<Record<DebtStatus, string>> = {
  settled_wallet: 'settled · wallet',
  settled_agent: 'settled · agent',
  settled_external: 'settled · direct',
};

interface Known {
  debtorId: string;
  creditorId: string;
  usdcMicro: string;
  seen: number;
  settled?: { digest: string; explorer: string; status?: DebtStatus; at?: string | null };
  gone?: boolean;
}
type KnownMap = Record<string, Known>;

/**
 * The group endpoint lists live debts only. To keep paid ones on screen with
 * their receipts, remember debts seen here and ask each one's x402 endpoint
 * once it leaves the live list (settled → 200 with digest, replaced → 410).
 */
function useSettled(groupId: string, live: Debt[]) {
  const key = `quits.debts.${groupId}`;
  const [known, setKnown] = useState<KnownMap>({});
  const checking = useRef(new Set<string>());

  useEffect(() => {
    setKnown(store.get<KnownMap>(key) ?? {});
  }, [key]);

  const save = useCallback(
    (fn: (k: KnownMap) => KnownMap) =>
      setKnown((prev) => {
        const next = fn(prev);
        const entries = Object.entries(next).sort((a, b) => b[1].seen - a[1].seen).slice(0, 40);
        const trimmed = Object.fromEntries(entries);
        store.set(key, trimmed);
        return trimmed;
      }),
    [key],
  );

  useEffect(() => {
    if (live.length === 0 && Object.keys(known).length === 0) return;
    const liveIds = new Set(live.map((d) => d.id));
    const fresh = live.filter((d) => !known[d.id] || known[d.id]!.usdcMicro !== d.usdcMicro);
    if (fresh.length) {
      save((k) => {
        const n = { ...k };
        for (const d of fresh) n[d.id] = { ...(n[d.id] ?? {}), debtorId: d.debtorId, creditorId: d.creditorId, usdcMicro: d.usdcMicro, seen: Date.now() };
        return n;
      });
    }
    const missing = Object.entries(known).filter(([id, k]) => !liveIds.has(id) && !k.settled && !k.gone && !checking.current.has(id)).slice(0, 8);
    if (missing.length === 0) return;
    for (const [id] of missing) checking.current.add(id);
    void (async () => {
      const results = await Promise.all(
        missing.map(async ([id]) => {
          const r = await call<{ settled?: boolean; digest?: string; explorer?: string }>(`/api/pay/${id}`).catch(() => null);
          return { id, r };
        }),
      );
      let proof: ProofData | null = null;
      if (results.some((x) => x.r?.status === 200 && x.r.data?.settled)) proof = (await call<ProofData>('/api/proof').catch(() => null))?.data ?? null;
      save((k) => {
        const n = { ...k };
        for (const { id, r } of results) {
          checking.current.delete(id);
          const cur = n[id];
          if (!cur || !r) continue;
          if (r.status === 200 && r.data?.settled && r.data.digest) {
            const s = proof?.settlements.find((x) => x.id === id);
            n[id] = { ...cur, settled: { digest: r.data.digest, explorer: r.data.explorer ?? '', ...(s ? { status: s.status, at: s.at } : {}) } };
          } else if (r.status === 410 || r.status === 404) n[id] = { ...cur, gone: true };
        }
        return n;
      });
    })();
  }, [live, known, save]);

  const remember = useCallback(
    (d: Debt, receipt: Receipt) =>
      save((k) => ({
        ...k,
        [d.id]: {
          debtorId: d.debtorId,
          creditorId: d.creditorId,
          usdcMicro: d.usdcMicro,
          seen: Date.now(),
          settled: { digest: receipt.digest, explorer: receipt.explorer, ...(receipt.status ? { status: receipt.status } : {}), at: new Date().toISOString() },
        },
      })),
    [save],
  );

  const liveIds = new Set(live.map((d) => d.id));
  const settled = Object.entries(known)
    .filter(([id, k]) => k.settled && !liveIds.has(id))
    .map(([id, k]) => ({ id, ...k, settled: k.settled! }))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 6);
  return { settled, remember };
}

interface Trace {
  phase: 'asking' | 'paying' | 'done' | 'error';
  ask?: X402Requirements;
  receipt?: Receipt;
  topUp?: { from: string; amount: string; digest: string } | null;
  error?: string;
}

function Leg({ code, tone, title, children }: { code: string; tone: 'warn' | 'ink' | 'wait'; title: string; children?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[40px_1fr] gap-3">
      <span className={`mono pt-px text-[12px] font-medium ${tone === 'warn' ? 'text-warn' : tone === 'ink' ? 'text-ink' : 'text-ink-3'}`}>{code}</span>
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">{title}</p>
        <div className="mono mt-0.5 text-[11.5px] leading-[1.6] break-words text-ink-3">{children}</div>
      </div>
    </li>
  );
}

function PayTrace({ t, creditor, debtor, demo, debtId }: { t: Trace; creditor: string; debtor: string; demo: boolean; debtId: string }) {
  const ex = useExplorer();
  const opt = t.ask?.accepts.find((a) => a.scheme === 'exact') ?? t.ask?.accepts[0];
  return (
    <ol className="panel rise mt-3 flex flex-col gap-3 p-3.5" aria-label="x402 payment">
      {opt ? (
        <Leg code="402" tone="warn" title="Payment required">
          {opt.scheme} · {opt.network} · {usdcFull(opt.amount)} USDC → {creditor} {short(opt.payTo)}
          <br />
          GET /api/pay/{short(debtId, 8, 4)}
        </Leg>
      ) : t.phase === 'asking' ? (
        <Leg code="···" tone="wait" title="Asking the debt’s x402 endpoint for its price" />
      ) : null}
      {t.topUp ? (
        <Leg code="pool" tone="wait" title="Demo wallet topped up from the demo pool first">
          {usdcFull(t.topUp.amount)} USDC from {short(t.topUp.from)} · gasless ·{' '}
          <ExtLink href={ex.tx(t.topUp.digest)} label={`Transaction ${t.topUp.digest} on Suiscan`}>
            {short(t.topUp.digest, 8, 6)}
          </ExtLink>
        </Leg>
      ) : null}
      {t.receipt ? (
        <Leg code="200" tone="ink" title={`Paid. ${debtor}’s signed USDC transfer settled on Sui`}>
          PAYMENT-SIGNATURE accepted{t.receipt.via ? ` · via ${t.receipt.via}` : ''}
          <br />
          digest{' '}
          <ExtLink href={t.receipt.explorer || ex.tx(t.receipt.digest)} label={`Transaction ${t.receipt.digest} on Suiscan`}>
            {short(t.receipt.digest, 8, 6)}
          </ExtLink>
        </Leg>
      ) : t.phase === 'paying' ? (
        <Leg code="···" tone="wait" title={`${debtor}’s wallet signs a USDC transfer and sends it back with PAYMENT-SIGNATURE`} />
      ) : null}
      {t.error ? (
        <li role="alert" className="grid grid-cols-[40px_1fr] gap-3">
          <span className="mono text-[12px] text-warn">×</span>
          <p className="text-[13.5px] text-[#f0d2b0]">{t.error}</p>
        </li>
      ) : null}
    </ol>
  );
}

function Recorded({ d }: { d: Debt }) {
  const left = useCountdown(d.pullableAt);
  return (
    <span className="chip chip-solid" title="Recorded on-chain under your mandate; the agent pays it when the objection window ends">
      auto-settling · {left === null ? 'soon' : left > 0 ? `pays in ${mmss(left)}` : 'paying now'}
    </span>
  );
}

export function SettleUp({ data, limit, onChanged }: { data: GroupData; limit: bigint; onChanged: () => void }) {
  const { me, startDemo, switching, demoTerms } = useSession();
  const ex = useExplorer();
  const wallet = useWallet();
  const demo = Boolean(me?.demo);
  const DEMO_CAP = toMicro(demoTerms.maxPerDebt);
  const [traces, setTraces] = useState<Record<string, Trace>>({});
  const [deciding, setDeciding] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { settled, remember } = useSettled(data.group.id, data.debts);

  const name = (id: string) => data.members.find((m) => m.id === id)?.name ?? 'someone';
  const mine = data.members.find((m) => m.id === data.me);
  const mandateOn = Boolean(mine?.autoSettle);
  const setTrace = (id: string, t: Partial<Trace>) => setTraces((p) => ({ ...p, [id]: { ...(p[id] ?? { phase: 'asking' }), ...t } }));

  async function pay(d: Debt) {
    setTrace(d.id, { phase: 'asking', error: undefined, receipt: undefined });
    // Leg one: the same public x402 endpoint any wallet or agent hits first.
    const first = await call<X402Requirements & { settled?: boolean; digest?: string; explorer?: string }>(`/api/pay/${d.id}`).catch(() => null);
    if (!first) return setTrace(d.id, { phase: 'error', error: 'Can’t reach the payment endpoint. Try again.' });
    if (first.status === 200 && first.data.settled && first.data.digest) {
      const receipt: Receipt = { settled: true, debtId: d.id, digest: first.data.digest, explorer: first.data.explorer ?? ex.tx(first.data.digest) };
      setTrace(d.id, { phase: 'done', receipt });
      remember(d, receipt);
      return onChanged();
    }
    if (first.status !== 402) return setTrace(d.id, { phase: 'error', error: (first.data as { error?: string })?.error ?? `The endpoint answered ${first.status}.` });
    setTrace(d.id, { ask: first.data, phase: 'paying' });
    if (!demo) {
      // Real member: the server builds the exact transfer, the wallet signs it, the x402 endpoint settles it.
      try {
        const prep = await api<{ txBytes: string }>(`/api/pay/${d.id}/prepare`, { body: {} });
        const signed = await wallet.signTxBytes(prep.txBytes);
        const header = btoa(JSON.stringify({ x402Version: 2, payload: { signature: signed.signature, transaction: signed.transaction } }));
        const res = await fetch(`/api/pay/${d.id}`, { credentials: 'include', cache: 'no-store', headers: { 'PAYMENT-SIGNATURE': header } });
        const body = (await res.json()) as Receipt & { error?: string };
        if (res.ok && body.settled) {
          setTrace(d.id, { phase: 'done', receipt: body });
          remember(d, body);
          onChanged();
        } else setTrace(d.id, { phase: 'error', error: body.error ?? `Payment answered ${res.status}.` });
      } catch (e) {
        setTrace(d.id, { phase: 'error', error: errorText(e) });
      }
      return;
    }
    try {
      const r = await api<DemoPay>(`/api/demo/pay/${d.id}`, { method: 'POST' });
      if ('settled' in r.receipt && r.receipt.settled) {
        setTrace(d.id, { phase: 'done', ask: r.challenge ?? first.data, receipt: r.receipt, topUp: r.topUp ?? null });
        remember(d, r.receipt);
        onChanged();
      } else {
        setTrace(d.id, { phase: 'error', error: 'error' in r.receipt ? r.receipt.error : `Payment answered ${r.status}.` });
      }
    } catch (e) {
      setTrace(d.id, { phase: 'error', error: errorText(e) });
    }
  }

  async function decide(d: Debt, decision: 'approve' | 'object') {
    setDeciding(d.id);
    setNote(null);
    try {
      const r = await api<{ limit: string }>(`/api/debts/${d.id}/decide`, { body: { decision } });
      setNote(
        decision === 'approve'
          ? `Approved. Your agent now pays up to ${usdc(r.limit)} USDC without asking.`
          : `Objected. Your agent now asks before paying more than ${usdc(r.limit)} USDC.`,
      );
      onChanged();
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setDeciding(null);
    }
  }

  const open = [...data.debts].sort((a, b) => Number((a.debtorId === data.me ? 0 : 1) - (b.debtorId === data.me ? 0 : 1)));

  // a debt paid in this session keeps its place at the top with its receipt; older ones sit below the open debts
  const settledRow = (s: (typeof settled)[number]) => {
          const t = traces[s.id];
          return (
            <li key={s.id} className="py-3.5">
              <div className="flex items-center gap-3 opacity-80">
                <span className="flex flex-none items-center -space-x-1.5">
                  <Avatar name={name(s.debtorId)} size={26} className="relative z-[1] bg-card" />
                  <Avatar name={name(s.creditorId)} size={26} className="bg-card" />
                </span>
                <span className="min-w-0 flex-1 text-[14px] leading-tight text-ink-2">
                  {s.debtorId === data.me ? 'You' : name(s.debtorId)} paid {s.creditorId === data.me ? 'you' : name(s.creditorId)}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="chip">{(s.settled.status && SETTLED_LABEL[s.settled.status]) ?? 'settled'}</span>
                    <ExtLink href={s.settled.explorer || ex.tx(s.settled.digest)} className="text-[11.5px]" label={`Transaction ${s.settled.digest} on Suiscan`}>
                      {short(s.settled.digest, 8, 6)}
                    </ExtLink>
                  </span>
                </span>
                <Money micro={s.usdcMicro} className="text-[15px] text-ink-2" />
              </div>
              {t ? (
                <div className="sm:pl-[50px]">
                  <PayTrace t={t} creditor={name(s.creditorId)} debtor={name(s.debtorId)} demo={demo} debtId={s.id} />
                </div>
              ) : null}
            </li>
          );
  };

  return (
    <section aria-labelledby="settle-h" className="sheet p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="settle-h" className="h-sec">
          Settle up
        </h2>
        <span className="meta">USDC on Sui · x402</span>
      </div>

      {open.length === 0 && settled.length === 0 ? <p className="mt-4 text-[14px] text-ink-2">Everyone’s even. New bills will show up here as debts.</p> : null}

      <ul className="mt-3 divide-y divide-line">
        {settled.filter((s) => traces[s.id]).map(settledRow)}
        {open.map((d) => {
          const isMine = d.debtorId === data.me;
          const amt = toMicro(d.usdcMicro);
          const t = traces[d.id];
          const overCap = demo && amt > DEMO_CAP;
          const asked = isMine && mandateOn && d.status === 'open' && amt > limit && (!demo || amt <= DEMO_CAP);
          const queued = isMine && mandateOn && d.status === 'open' && amt <= limit && (!demo || amt <= DEMO_CAP);
          return (
            <li key={d.id} className="py-3.5">
              <div className="flex items-center gap-3">
                <span className="flex flex-none items-center -space-x-1.5">
                  <Avatar name={name(d.debtorId)} size={26} active={isMine} className="relative z-[1] bg-card" />
                  <Avatar name={name(d.creditorId)} size={26} className="bg-card" />
                </span>
                <span className="min-w-0 flex-1 text-[14px] leading-tight">
                  <span className={isMine ? 'font-semibold text-ink' : 'text-ink-2'}>{isMine ? 'You owe' : `${name(d.debtorId)} owes`}</span> <span className="text-ink-2">{d.creditorId === data.me ? 'you' : name(d.creditorId)}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {d.status === 'recorded' ? <Recorded d={d} /> : <span className="chip">open</span>}
                    {queued && !t ? <span className="chip chip-quiet">your agent picks this up</span> : null}
                  </span>
                </span>
                <Money micro={d.usdcMicro} className="text-[15px]" />
              </div>

              {isMine && d.status === 'open' && t?.phase !== 'done' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-[50px]">
                  <button type="button" className="btn btn-ink btn-sm" onClick={() => void pay(d)} disabled={overCap || (t && t.phase !== 'error')}>
                    {t?.phase === 'asking' ? 'Asking…' : t?.phase === 'paying' ? 'Paying…' : `Pay ${usdc(d.usdcMicro)} USDC`}
                  </button>
                  {overCap ? <span className="meta">Demo wallets pay up to {usdc(DEMO_CAP)} USDC per debt. The Coffee tab keeps its debts small.</span> : null}
                </div>
              ) : null}

              {asked ? (
                <div className="teach mt-3 ml-[50px]">
                  <p className="text-[13.5px] text-ink">
                    Your agent is asking: this is over your auto-pay limit of <Money micro={limit} />. Let it pay?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn btn-mem btn-sm" disabled={deciding !== null} onClick={() => void decide(d, 'approve')}>
                      {deciding === d.id ? 'Saving…' : 'Approve'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={deciding !== null} onClick={() => void decide(d, 'object')}>
                      Object
                    </button>
                  </div>
                </div>
              ) : null}

              {!isMine && demo && d.status === 'open' && amt <= DEMO_CAP ? (
                <div className="mt-2 pl-[50px]">
                  <button type="button" className="btn btn-quiet text-[12.5px]" disabled={Boolean(switching)} onClick={() => void startDemo(name(d.debtorId))}>
                    {switching === name(d.debtorId) ? `Switching to ${name(d.debtorId)}…` : `Switch to ${name(d.debtorId)} to pay this`}
                  </button>
                </div>
              ) : null}

              {t ? (
                <div className="pl-0 sm:pl-[50px]" aria-live="polite">
                  <PayTrace t={t} creditor={name(d.creditorId)} debtor={name(d.debtorId)} demo={demo} debtId={d.id} />
                </div>
              ) : null}
            </li>
          );
        })}
        {settled.filter((s) => !traces[s.id]).map(settledRow)}
      </ul>
      <div aria-live="polite">{note ? <p className="notice mt-3">{note}</p> : null}</div>
    </section>
  );
}
