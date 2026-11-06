'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from './api.ts';
import { initials, toMicro } from './format.ts';
import { useSession, visibleGroups } from './session.tsx';
import type { GroupData, GroupRef } from './types.ts';
import { ErrorBlock, LoadingBlock, Money, SignInPrompt, Skeleton } from './ui.tsx';

function Standing({ micro }: { micro: string }) {
  const v = toMicro(micro);
  if (v === 0n) return <span className="text-[13.5px] text-ink-3">Settled up</span>;
  return (
    <span className="text-right text-[13.5px] text-ink-2">
      {v > 0n ? 'You’re owed ' : 'You owe '}
      <Money micro={v > 0n ? v : -v} className="text-ink" />
    </span>
  );
}

function GroupRow({ g, uid, own }: { g: GroupRef; uid: string; own: boolean }) {
  const [bal, setBal] = useState<string | null>(null);
  const [people, setPeople] = useState<string[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api<GroupData>(`/api/groups/${g.id}`, { signal: ac.signal })
      .then((d) => {
        setBal(d.balances[uid] ?? '0');
        setPeople(d.members.map((m) => m.name));
      })
      .catch(() => {});
    return () => ac.abort();
  }, [g.id, uid]);

  return (
    <li>
      <Link href={`/g/${g.id}`} className="flex items-center gap-4 rounded-[18px] px-4 py-4 transition-colors hover:bg-[rgba(242,236,228,.035)] sm:px-5">
        <span className="tile">{initials(g.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15.5px] font-semibold tracking-[-0.01em]">{g.name}</span>
            {own ? <span className="chip chip-quiet">your tab</span> : null}
          </span>
          <span className="meta mt-0.5 block truncate">
            {people ? people.join(', ') : 'Loading members…'} · bills in {g.defaultCurrency}
          </span>
        </span>
        <span className="flex-none">{bal === null ? <Skeleton h={16} w={92} /> : <Standing micro={bal} />}</span>
      </Link>
    </li>
  );
}

function CreateJoin({ onDone }: { onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const r = await api<{ id: string }>('/api/groups', { body: { name, currency } });
      onDone(r.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy('join');
    setError(null);
    try {
      const r = await api<{ id: string }>('/api/groups/join', { body: { code } });
      onDone(r.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <form onSubmit={create} className="sheet p-5 sm:p-6">
        <h2 className="h-sec">Start a group</h2>
        <div className="mt-4 grid grid-cols-[1fr_96px] gap-2">
          <div>
            <label htmlFor="g-name" className="label">
              Name
            </label>
            <input id="g-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Flat 5B" maxLength={60} required />
          </div>
          <div>
            <label htmlFor="g-cur" className="label">
              Currency
            </label>
            <select id="g-cur" className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['USD', 'EUR', 'GBP', 'PLN', 'CHF', 'UAH'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-ink mt-4" disabled={busy !== null || !name.trim()}>
          {busy === 'create' ? 'Creating…' : 'Create group'}
        </button>
      </form>
      <form onSubmit={join} className="sheet p-5 sm:p-6">
        <h2 className="h-sec">Join with a code</h2>
        <div className="mt-4">
          <label htmlFor="g-code" className="label">
            Invite code
          </label>
          <input id="g-code" className="field mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="F2A853A2" maxLength={16} required />
        </div>
        <button className="btn btn-ghost mt-4" disabled={busy !== null || !code.trim()}>
          {busy === 'join' ? 'Joining…' : 'Join group'}
        </button>
      </form>
      <div aria-live="polite" className="md:col-span-2">
        {error ? <ErrorBlock message={error} /> : null}
      </div>
    </div>
  );
}

/** Wallet sign-in starts you as a shortened address; bills and corrections need a name. */
function NameCard({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/me', { body: { name } });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="sheet mt-8 p-5 sm:p-6">
      <h2 className="h-sec">What should your groups call you?</h2>
      <p className="mt-2 text-[14px] text-ink-2">People write &ldquo;Ana doesn&rsquo;t drink&rdquo;, not an address. Quits matches names in bills and corrections to members.</p>
      <div className="mt-4 flex gap-2">
        <label htmlFor="me-name" className="sr-only">
          Your name
        </label>
        <input id="me-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana" maxLength={40} required />
        <button className="btn btn-ink flex-none" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? <p className="notice notice-warn mt-3" role="alert">{error}</p> : null}
    </form>
  );
}

export function GroupsView() {
  const { me, state, tabKey, refresh } = useSession();
  const router = useRouter();

  if (state === 'loading') return <div className="pt-12"><LoadingBlock label="Loading your groups" /></div>;
  if (state === 'error') return <div className="pt-12"><ErrorBlock message="Couldn’t load your groups." onRetry={() => void refresh()} /></div>;
  if (state === 'anon' || !me?.user) return <SignInPrompt what="Your groups" />;

  const groups = visibleGroups(me, tabKey);
  const own = tabKey ? `demo-tab-${tabKey}` : null;

  return (
    <div className="pt-8 md:pt-12">
      <h1 className="h-page">Your groups</h1>
      <p className="lede mt-3">
        {me.demo
          ? `You’re ${me.user.name} in the demo. Your Coffee tab is yours to change; Flat 5B and the Lisbon trip are shared with every visitor.`
          : 'Every group keeps its own memory of how you split things.'}
      </p>

      {!me.demo && /^0x[0-9a-f]{4}…[0-9a-f]{4}$/i.test(me.user.name) ? <NameCard onSaved={() => void refresh()} /> : null}

      <section className="sheet mt-8 p-2" aria-label="Groups">
        {groups.length === 0 ? (
          <div className="p-6 text-ink-2">
            {me.demo ? (
              <>
                No groups yet.{' '}
                <Link className="link" href="/demo">
                  Open a Coffee tab
                </Link>
              </>
            ) : (
              'No groups yet. Start one below or join with a code from a friend.'
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <GroupRow key={g.id} g={g} uid={me.user!.id} own={g.id === own} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10">
        {me.demo ? (
          <p className="meta max-w-[46em]">
            Starting and joining your own groups comes with wallet sign-in. In the demo, switch flatmates at the top to see the same tab from someone else’s side.
          </p>
        ) : (
          <CreateJoin
            onDone={(id) => {
              void refresh();
              router.push(`/g/${id}`);
            }}
          />
        )}
      </div>
    </div>
  );
}
