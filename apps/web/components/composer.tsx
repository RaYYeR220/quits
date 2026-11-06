'use client';

import { useRef, useState } from 'react';
import { api, errorText } from './api.ts';
import { fiat, initials, toMicro } from './format.ts';
import type { AddResult, CorrectResult, GroupData, Missing, Proposal } from './types.ts';
import { ErrorBlock, Money } from './ui.tsx';
import { SplitRows, WhyList } from './why.tsx';

const MISSING: Record<Missing, string> = {
  amount: 'how much it was, like “24 USD”',
  payer: 'who paid, like “I paid” or “Ben paid”',
  currency: 'the currency after the amount, like “84 EUR”',
};

type Outcome =
  | { kind: 'learned'; sentence: string; scope: 'group' | 'member' }
  | { kind: 'once'; absent: string[]; payer?: string }
  | { kind: 'clarify'; question: string };

export function Composer({ data, ownerOf, onPosted, onLearned }: { data: GroupData; ownerOf: (ruleId: string) => string | null; onPosted: () => void; onLearned: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<null | 'split' | 'fix' | 'accept'>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [fixText, setFixText] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [posted, setPosted] = useState<string | null>(null);
  const billRef = useRef<HTMLTextAreaElement>(null);
  const fixRef = useRef<HTMLInputElement>(null);

  const name = (id: string) => data.members.find((m) => m.id === id)?.name ?? 'someone';

  function reset() {
    setProposal(null);
    setOutcome(null);
    setFixOpen(false);
    setFixText('');
    setProblem(null);
    setError(null);
  }

  async function split(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    reset();
    setPosted(null);
    setBusy('split');
    try {
      const r = await api<AddResult>(`/api/groups/${data.group.id}/expenses`, { body: { text } });
      if (r.ok) setProposal(r.proposal);
      else if ('missing' in r) setProblem(`Add ${r.missing.map((m) => MISSING[m]).join(', and ')}.`);
      else setProblem(`There’s no exchange rate for ${r.fxUnavailable} right now. Give the amount in USD instead.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function fix(e: React.FormEvent) {
    e.preventDefault();
    if (!proposal || !fixText.trim() || busy) return;
    setBusy('fix');
    setError(null);
    try {
      const r = await api<CorrectResult>(`/api/expenses/${proposal.draftId}/correct`, { body: { text: fixText } });
      if (!r.ok) {
        setOutcome({ kind: 'clarify', question: r.clarify });
        setFixText('');
        fixRef.current?.focus();
        return;
      }
      setProposal(r.proposal);
      setFixText('');
      setFixOpen(false);
      if (r.learned) {
        setOutcome({ kind: 'learned', sentence: r.learned.sentence, scope: r.learned.scope });
        onLearned();
      } else setOutcome({ kind: 'once', absent: r.fixed?.absent ?? [], ...(r.fixed?.payer ? { payer: r.fixed.payer } : {}) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function accept() {
    if (!proposal || busy) return;
    setBusy('accept');
    setError(null);
    try {
      await api(`/api/expenses/${proposal.draftId}/accept`, { method: 'POST' });
      setPosted(`Posted “${proposal.expense.description}”. Balances and debts are updated.`);
      reset();
      setText('');
      onPosted();
      billRef.current?.focus();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const p = proposal;
  const payerShare = p ? toMicro(p.shares[p.expense.payerId] ?? '0') : 0n;
  const owed = p ? toMicro(p.expense.usdcMicro) - payerShare : 0n;
  const touched = new Set(p?.why.flatMap((w) => w.appliesTo) ?? []);

  return (
    <section aria-labelledby="new-bill" className="card p-2">
      <div className="flex items-center justify-between px-3.5 pt-3 pb-3.5">
        <div className="flex items-center gap-2.5 text-[14px] font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-[9px] border border-line-2 font-mono text-[11px] font-medium text-ink-2">{initials(data.group.name)}</span>
          <div>
            <h2 id="new-bill">{p ? p.expense.description : 'New bill'}</h2>
            <small className="block text-[12px] font-normal text-ink-3">{data.members.map((m) => m.name).join(', ')}</small>
          </div>
        </div>
        <span className="mono text-[12px] text-ink-3">{busy === 'split' ? 'Reading memory…' : p ? 'Draft' : ''}</span>
      </div>

      <div className="panel px-4 pt-4 pb-3.5 transition-colors has-[#bill:focus-visible]:border-[rgba(185,168,255,.5)]">
        <form onSubmit={split}>
          <label htmlFor="bill" className="label">
            Log a bill in plain words
          </label>
          <textarea
            id="bill"
            ref={billRef}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void split();
              }
            }}
            maxLength={400}
            placeholder="Pizza night 24 USD, I paid, 8 of it was beer"
            className="w-full resize-none bg-transparent text-[16.5px] leading-[1.45] tracking-[-0.01em] text-ink placeholder:text-ink-3 focus-visible:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="meta">Enter to split · Shift+Enter for a new line</span>
            <button className="btn btn-ink btn-sm" disabled={!text.trim() || busy !== null}>
              {busy === 'split' ? 'Splitting…' : p ? 'Split again' : 'Split it'}
            </button>
          </div>
        </form>

        <div aria-live="polite" aria-busy={busy !== null}>
          {busy === 'split' ? <p className="mt-4 text-[13.5px] text-ink-3">Reading what this group remembers from Walrus…</p> : null}
          {problem ? <p className="notice notice-warn mt-4">{problem}</p> : null}
          {posted && !p ? <p className="notice mt-4 text-ink">{posted}</p> : null}

          {p ? (
            <div className="rise mt-4">
              <div className="flex flex-wrap gap-1.5">
                <span className="chip" title={`${p.expense.usdcMicro} micro-USDC`}>
                  <Money micro={p.expense.usdcMicro} /> USDC
                </span>
                {p.expense.currency !== 'USD' && p.expense.currency !== 'USDC' ? (
                  <span className="chip" title={p.fx ? `rate ${p.fx.rate} from ${p.fx.source}` : undefined}>
                    {fiat(p.expense.amountMinor, p.expense.currency)}
                  </span>
                ) : null}
                <span className="chip">{name(p.expense.payerId)} paid</span>
                <span className="chip">{p.expense.category}</span>
                {p.expense.items.map((it, i) => (
                  <span key={i} className={`chip ${touched.has(it.label) ? 'chip-mem' : ''}`}>
                    {it.label} <Money micro={it.usdcMicro} />
                    {it.tags.length ? ` · ${it.tags.join(', ')}` : ''}
                  </span>
                ))}
              </div>

              <div className="mt-2 px-1">
                <SplitRows split={p} members={data.members} meId={data.me} />
              </div>

              <div className="mt-3">
                <WhyList split={p} ownerOf={ownerOf} />
              </div>

              <p className="mono mt-3 px-1 text-[11.5px] text-ink-3">
                Read {p.memoriesRead} {p.memoriesRead === 1 ? 'memory' : 'memories'} from Walrus for this split
                {p.conflict ? ' · two rules disagreed, so the newest one won' : ''}
              </p>
              {p.degraded ? (
                <p className="notice notice-warn mt-2">Walrus Memory didn’t answer, so this split used the rules cached here. They’re the same rules, just not re-read this time.</p>
              ) : null}

              {outcome?.kind === 'learned' ? (
                <div className="teach rise mt-3">
                  <small className="block text-[11.5px] text-ink-3">
                    Learned {outcome.scope === 'member' ? 'into their own memory' : 'for this group'} · saving to Walrus · applies to every bill after this
                  </small>
                  <p className="mt-1 text-[14.5px]">{outcome.sentence}</p>
                </div>
              ) : null}
              {outcome?.kind === 'once' ? (
                <div className="notice rise mt-3">
                  <span className="text-ink">Fixed for this bill · nothing learned.</span>
                  {outcome.absent.length ? ` Left out: ${outcome.absent.map(name).join(', ')}.` : ''}
                  {outcome.payer ? ` Paid by ${name(outcome.payer)}.` : ''}
                </div>
              ) : null}
              {outcome?.kind === 'clarify' ? (
                <div className="notice rise mt-3">
                  <span className="block text-[11.5px] text-ink-3">Quits needs one more detail</span>
                  <span className="text-ink">{outcome.question}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {p ? (
        <>
          {fixOpen || outcome?.kind === 'clarify' ? (
            <form onSubmit={fix} className="rise px-3 pt-3">
              <label htmlFor="fix" className="label">
                {outcome?.kind === 'clarify' ? 'Your answer' : 'What’s wrong with it?'}
              </label>
              <div className="flex gap-2">
                <input
                  id="fix"
                  ref={fixRef}
                  className="field"
                  value={fixText}
                  onChange={(e) => setFixText(e.target.value)}
                  placeholder="Dan wasn’t there, leave him out"
                  maxLength={300}
                  autoFocus
                />
                <button className="btn btn-mem flex-none" disabled={!fixText.trim() || busy !== null}>
                  {busy === 'fix' ? 'Fixing…' : 'Fix the split'}
                </button>
              </div>
              <p className="meta mt-2">Say it like you would to the group. A lasting habit becomes a memory; a one-off only fixes this bill.</p>
            </form>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3.5 pb-2">
            <span className="text-[13.5px] text-ink-2">
              {owed > 0n ? (
                <>
                  {name(p.expense.payerId)} is owed <Money micro={owed} className="text-ink" />
                </>
              ) : (
                'Nobody owes anything for this'
              )}
            </span>
            <div className="flex gap-1.5">
              <button type="button" className="btn btn-quiet btn-sm" onClick={reset} disabled={busy !== null}>
                Discard
              </button>
              {!fixOpen && outcome?.kind !== 'clarify' ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFixOpen(true)} disabled={busy !== null}>
                  Fix it
                </button>
              ) : null}
              <button type="button" className="btn btn-ink btn-sm" onClick={() => void accept()} disabled={busy !== null}>
                {busy === 'accept' ? 'Posting…' : 'Looks right'}
              </button>
            </div>
          </div>
        </>
      ) : null}
      {error ? (
        <div className="px-2 pt-2 pb-1">
          <ErrorBlock message={error} />
        </div>
      ) : null}
    </section>
  );
}
