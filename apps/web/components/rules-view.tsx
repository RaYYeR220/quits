'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText } from './api.ts';
import { day, toMicro } from './format.ts';
import { useGroup } from './group-view.tsx';
import { useSession } from './session.tsx';
import type { GroupData, ListedRule, Split } from './types.ts';
import { ErrorBlock, LoadingBlock, SignInPrompt, Skeleton } from './ui.tsx';
import { BlobRef, SplitRows, WhyList } from './why.tsx';

const MEMORY: Record<NonNullable<ListedRule['memoryState']> | 'none', { text: string; cls: string }> = {
  done: { text: 'stored on Walrus', cls: 'text-ink-2' },
  submitted: { text: 'writing to Walrus', cls: 'text-warn' },
  queued: { text: 'queued for Walrus', cls: 'text-warn' },
  failed: { text: 'Walrus write failed, kept here', cls: 'text-warn' },
  none: { text: 'not in memory', cls: 'text-ink-3' },
};

const STATUS: Record<ListedRule['status'], { text: string; cls: string }> = {
  active: { text: 'active', cls: 'chip chip-mem' },
  superseded: { text: 'replaced by a newer rule', cls: 'chip chip-quiet' },
  revocation: { text: 'revoked', cls: 'chip chip-warn' },
};

function RuleRow({ r, owner }: { r: ListedRule; owner: string | null }) {
  const mem = MEMORY[r.memoryState ?? 'none'];
  const st = STATUS[r.status];
  const dim = r.status !== 'active';
  return (
    <li className="grid grid-cols-[52px_1fr] gap-3 py-4 sm:grid-cols-[64px_1fr_auto] sm:gap-4">
      <span className={`mono pt-[3px] text-[12px] ${dim ? 'text-ink-3' : 'text-mem'}`}>{day(r.learnedAt)}</span>
      <div className="min-w-0">
        <p className={`text-[15px] leading-[1.45] ${dim ? 'text-ink-3 line-through decoration-line-2' : 'text-ink'}`}>{r.sentence}</p>
        <p className="mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
          <span className={r.scope === 'member' ? 'text-mem' : ''}>{r.scope === 'member' ? `${owner ?? 'A member'}’s own memory, follows them to every group` : 'group rule'}</span>
          <span aria-hidden="true">·</span>
          <span>{r.kind}</span>
          <span aria-hidden="true">·</span>
          <span className={mem.cls}>{mem.text}</span>
          {r.blobId ? (
            <>
              <span aria-hidden="true">·</span>
              <BlobRef blobId={r.blobId} />
            </>
          ) : null}
        </p>
      </div>
      <span className="col-start-2 sm:col-start-3">
        <span className={st.cls}>{st.text}</span>
      </span>
    </li>
  );
}

/** The Best-Memory moment: one bill split with what Quits knew on day one, and with what it knows now. */
function DayOne({ data, ownerOf }: { data: GroupData; ownerOf: (ruleId: string) => string | null }) {
  const candidates = data.expenses;
  const pickDefault = useCallback(() => (candidates.find((h) => new Set(h.applied.map((a) => a.ruleId)).size >= 2) ?? candidates.find((h) => h.applied.length > 0) ?? candidates[0])?.expense.id ?? '', [candidates]);
  const [sel, setSel] = useState('');
  const [then, setThen] = useState<Split | null>(null);
  const [now, setNow] = useState<Split | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sel) setSel(pickDefault());
  }, [sel, pickDefault]);

  useEffect(() => {
    if (!sel) return;
    let live = true;
    setBusy(true);
    setError(null);
    const asOfThen = new Date(data.group.createdAt).toISOString();
    const asOfNow = new Date().toISOString();
    Promise.all([api<Split>(`/api/expenses/${sel}/replay?asOf=${encodeURIComponent(asOfThen)}`), api<Split>(`/api/expenses/${sel}/replay?asOf=${encodeURIComponent(asOfNow)}`)])
      .then(([a, b]) => {
        if (!live) return;
        setThen(a);
        setNow(b);
      })
      .catch((e) => live && setError(errorText(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [sel, data.group.createdAt]);

  const portableOnDayOne = then?.why.filter((w) => w.scope === 'member').length ?? 0;
  const moved = then && now ? data.members.reduce((n, m) => n + (toMicro(then.shares[m.id] ?? '0') !== toMicro(now.shares[m.id] ?? '0') ? 1 : 0), 0) : 0;

  if (candidates.length === 0) {
    return (
      <section className="sheet p-6" aria-labelledby="d1-h">
        <h2 id="d1-h" className="h-sec">
          Day one vs today
        </h2>
        <p className="mt-2 text-[14px] text-ink-2">Post a bill first; then you can replay it with what Quits knew on the group’s first day.</p>
      </section>
    );
  }

  return (
    <section className="sheet p-5 sm:p-6" aria-labelledby="d1-h">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[34em]">
          <h2 id="d1-h" className="h-sec">
            Day one vs today
          </h2>
          <p className="mt-1.5 text-[14px] leading-[1.55] text-ink-2">The same bill, split twice: once with only what Quits knew when the group started on {day(data.group.createdAt)}, once with everything it remembers now.</p>
        </div>
        <div className="w-full sm:w-[300px]">
          <label htmlFor="replay-bill" className="label">
            Bill
          </label>
          <select id="replay-bill" className="field" value={sel} onChange={(e) => setSel(e.target.value)}>
            {candidates.map((h) => (
              <option key={h.expense.id} value={h.expense.id}>
                {h.expense.description} · {day(h.expense.occurredAt)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div aria-live="polite" aria-busy={busy} className="mt-5">
        {error ? <ErrorBlock message={error} /> : null}
        {!then || !now ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Skeleton h={260} />
            <Skeleton h={260} />
          </div>
        ) : (
          <>
            <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${busy ? 'opacity-60' : ''}`}>
              <div className="panel p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[14px] font-semibold">Day one</h3>
                  <span className="mono text-[11.5px] text-ink-3">as of {day(data.group.createdAt)}</span>
                </div>
                <div className="mt-2">
                  <SplitRows split={then} members={data.members} meId={data.me} />
                </div>
                <div className="mt-3">
                  <WhyList split={then} ownerOf={ownerOf} empty="Nothing remembered yet, so it splits evenly." />
                </div>
                <p className="mono mt-3 text-[11.5px] text-ink-3">{then.memoriesRead} memories read</p>
              </div>
              <div className="panel border-[rgba(185,168,255,.28)] p-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[14px] font-semibold">Today</h3>
                  <span className="mono text-[11.5px] text-ink-3">as of {day(new Date().toISOString())}</span>
                </div>
                <div className="mt-2">
                  <SplitRows split={now} members={data.members} meId={data.me} compare={then} />
                </div>
                <div className="mt-3">
                  <WhyList split={now} ownerOf={ownerOf} />
                </div>
                <p className="mono mt-3 text-[11.5px] text-ink-3">{now.memoriesRead} memories read</p>
              </div>
            </div>
            <p className="mt-4 text-[13.5px] text-ink-2">
              {moved === 0
                ? 'Same split both days: nothing learned since changes this bill.'
                : `What it learned moves ${moved} of ${data.members.length} shares on this bill.`}
              {portableOnDayOne > 0 ? ' On day one it already knew members’ own rules: those came with them from other groups.' : ''}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export function RulesView({ id }: { id: string }) {
  const { me } = useSession();
  const { data, rules, setRules, error, load, sessionState } = useGroup(id);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuilt, setRebuilt] = useState<string | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const m = new Map((data?.members ?? []).map((x) => [x.id, x.name]));
    return (uid: string | null) => (uid ? (m.get(uid) ?? null) : null);
  }, [data]);

  const ownerOf = useCallback(
    (ruleId: string) => {
      const r = rules?.find((x) => x.id === ruleId);
      return r?.scope === 'member' ? nameOf(r.ownerId) : null;
    },
    [rules, nameOf],
  );

  async function rebuild() {
    setRebuilding(true);
    setRebuilt(null);
    setRebuildError(null);
    try {
      const r = await api<{ rebuilt: number; indexed: number; complete: boolean; ms: number; rules: ListedRule[] }>(`/api/groups/${id}/rebuild`, { method: 'POST' });
      setRules(r.rules);
      const secs = r.ms.toLocaleString('en-US');
      if (!r.complete) {
        setRebuildError(
          `Walrus returned ${r.rebuilt} of the ${r.indexed} stored ${r.indexed === 1 ? 'rule' : 'rules'} (${secs} ms), so the local index was kept as it is. Try again in a minute.`,
        );
      } else {
        setRebuilt(`Rebuilt ${r.rebuilt} ${r.rebuilt === 1 ? 'rule' : 'rules'} from Walrus in ${secs} ms. The local index was replaced; every rule below was read back from memory.`);
      }
    } catch (e) {
      setRebuildError(errorText(e));
    } finally {
      setRebuilding(false);
    }
  }

  if (sessionState === 'anon' || error?.status === 401) return <SignInPrompt what="This group’s rules" />;
  if (error && !data)
    return (
      <div className="mx-auto mt-16 max-w-xl">
        <ErrorBlock message={error.status === 403 ? `${me?.user?.name ?? 'You'} isn’t in this group.` : error.message} onRetry={() => void load()} />
      </div>
    );
  if (!data) return <div className="pt-12"><LoadingBlock label="Loading what this group has learned" rows={5} /></div>;

  const active = (rules ?? []).filter((r) => r.status === 'active');
  const older = (rules ?? []).filter((r) => r.status !== 'active');

  return (
    <div className="pt-6 md:pt-10">
      <Link href={`/g/${id}`} className="meta link">
        {data.group.name}
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h-page">What Quits has learned</h1>
          <p className="lede mt-3">Every rule came from one correction. Group rules live in this group’s memory; members’ own rules live in theirs and travel with them.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void rebuild()} disabled={rebuilding}>
          {rebuilding ? 'Reading Walrus…' : 'Rebuild from Walrus'}
        </button>
      </div>
      <div aria-live="polite" className="mt-4">
        {rebuilt ? <p className="teach rise text-[14px]">{rebuilt}</p> : null}
        {rebuildError ? <ErrorBlock message={rebuildError} /> : null}
      </div>

      <section aria-labelledby="rules-h" className="sheet mt-6 px-5 py-2 sm:px-6">
        <h2 id="rules-h" className="sr-only">
          Rules
        </h2>
        {!rules ? (
          <div className="py-4">
            <LoadingBlock label="Loading rules" />
          </div>
        ) : rules.length === 0 ? (
          <p className="py-6 text-[14px] text-ink-2">
            Nothing learned yet. Log a bill on the{' '}
            <Link className="link" href={`/g/${id}`}>
              group page
            </Link>{' '}
            and fix its split once; Quits keeps the lesson.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((r) => (
              <RuleRow key={r.id} r={r} owner={nameOf(r.ownerId)} />
            ))}
            {older.map((r) => (
              <RuleRow key={r.id} r={r} owner={nameOf(r.ownerId)} />
            ))}
          </ul>
        )}
        {rules && rules.length ? (
          <p className="meta border-t border-line py-3">
            {active.length} active · {rules.filter((r) => r.memoryState === 'done').length} stored on Walrus · {rules.filter((r) => r.scope === 'member').length} in members’ own memory
          </p>
        ) : null}
      </section>

      <div className="mt-6">
        <DayOne data={data} ownerOf={ownerOf} />
      </div>

      <p className="meta mt-6">
        Each rule is one memory blob.{' '}
        <Link className="link" href="/proof">
          See every memory Quits has written
        </Link>
      </p>
    </div>
  );
}
