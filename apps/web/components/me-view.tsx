'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from './api.ts';
import { day, short } from './format.ts';
import { useExplorer, useSession, visibleGroups } from './session.tsx';
import type { ListedRule } from './types.ts';
import { Avatar, CopyButton, ErrorBlock, ExtLink, LoadingBlock, Money, SignInPrompt } from './ui.tsx';
import { BlobRef } from './why.tsx';

function PortableMemory({ uid, groupIds }: { uid: string; groupIds: string[] }) {
  const [rules, setRules] = useState<(ListedRule & { groups: number })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = groupIds.join(',');

  useEffect(() => {
    let live = true;
    setRules(null);
    Promise.all(groupIds.map((g) => api<{ rules: ListedRule[] }>(`/api/groups/${g}/rules`).then((r) => r.rules).catch(() => [] as ListedRule[])))
      .then((lists) => {
        if (!live) return;
        const byId = new Map<string, ListedRule & { groups: number }>();
        for (const list of lists)
          for (const r of list) {
            if (r.scope !== 'member' || r.ownerId !== uid) continue;
            const cur = byId.get(r.id);
            byId.set(r.id, { ...r, groups: (cur?.groups ?? 0) + 1 });
          }
        setRules([...byId.values()].sort((a, b) => (a.learnedAt < b.learnedAt ? 1 : -1)));
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [uid, key]);

  if (error) return <ErrorBlock message={error} />;
  if (!rules) return <LoadingBlock label="Reading your memory" rows={2} />;
  if (rules.length === 0)
    return <p className="text-[14px] leading-[1.55] text-ink-2">Nothing in your own memory yet. When a correction is about you, like “I don’t drink”, it’s kept here and follows you into every group.</p>;
  return (
    <ul className="divide-y divide-line">
      {rules.map((r) => (
        <li key={r.id} className="grid grid-cols-[52px_1fr] gap-3 py-3.5">
          <span className="mono pt-[3px] text-[12px] text-mem">{day(r.learnedAt)}</span>
          <div>
            <p className="text-[15px] leading-[1.45]">{r.sentence}</p>
            <p className="mono mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
              <span className="text-mem">
                applies in {r.groups} of your {groupIds.length} groups
              </span>
              <span aria-hidden="true">·</span>
              <span>{r.memoryState === 'done' ? 'stored on Walrus' : r.memoryState ? `${r.memoryState} for Walrus` : 'not in memory'}</span>
              {r.blobId ? (
                <>
                  <span aria-hidden="true">·</span>
                  <BlobRef blobId={r.blobId} />
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OwnMemory({ demo, current, onSaved }: { demo: boolean; current: string | null; onSaved: () => void }) {
  const [acc, setAcc] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/me/memory', { body: { accountId: acc.trim() } });
      setMsg({ ok: true, text: 'Done. New memories about you are written to your own account from now on.' });
      setAcc('');
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      {current ? (
        <p className="mb-4 text-[14px] text-ink-2">
          Your memory lives in your own Walrus Memory account <span className="mono text-ink">{short(current, 8, 6)}</span>. Remove the Quits delegate there and Quits can no longer read or write it.
        </p>
      ) : (
        <p className="mb-4 text-[14px] leading-[1.55] text-ink-2">
          Keep the rules about you in a Walrus Memory account you own. Add Quits as a delegate on that account, then paste its id here. You can revoke the delegate any time.
        </p>
      )}
      <label htmlFor="acc" className="label">
        Walrus Memory account id
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="acc"
          className="field mono text-[13.5px]"
          value={acc}
          onChange={(e) => setAcc(e.target.value)}
          placeholder="0x…"
          pattern="^0x[0-9a-fA-F]{64}$"
          title="0x followed by 64 hex characters"
          disabled={demo}
          aria-describedby={demo ? 'acc-demo' : undefined}
          required
        />
        <button className="btn btn-ink flex-none" disabled={demo || busy || !acc.trim()}>
          {busy ? 'Checking access…' : 'Use my account'}
        </button>
      </div>
      {demo ? (
        <p id="acc-demo" className="meta mt-2">
          Demo flatmates share the Quits demo account, so this is off here. Sign in with your own wallet to move your memory to your own account.
        </p>
      ) : null}
      <div aria-live="polite">{msg ? <p className={`notice mt-3 ${msg.ok ? 'text-ink' : 'notice-warn'}`}>{msg.text}</p> : null}</div>
    </form>
  );
}

function ConnectAgent() {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<{ token: string; mcpUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setToken(await api<{ token: string; mcpUrl: string }>('/api/me/tokens', { body: { label: 'agent' } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const snippet = token ? JSON.stringify({ mcpServers: { quits: { url: token.mcpUrl, headers: { Authorization: `Bearer ${token.token}` } } } }, null, 2) : '';

  return (
    <div>
      <p className="text-[14px] leading-[1.55] text-ink-2">Log bills, fix splits and check who owes what from any MCP client. It reads and writes the same group memory as this app.</p>
      {!token ? (
        <button type="button" className="btn btn-ghost mt-4" onClick={() => void create()} disabled={busy}>
          {busy ? 'Creating…' : 'Create a connection token'}
        </button>
      ) : (
        <div className="rise mt-4 flex flex-col gap-3" aria-live="polite">
          <p className="notice notice-warn">Shown once. Copy it now; create a new one if you lose it.</p>
          <div>
            <span className="label">MCP URL</span>
            <div className="flex items-center gap-2">
              <code className="panel mono min-w-0 flex-1 truncate px-3 py-2 text-[12.5px]">{token.mcpUrl}</code>
              <CopyButton text={token.mcpUrl} />
            </div>
          </div>
          <div>
            <span className="label">Token</span>
            <div className="flex items-center gap-2">
              <code className="panel mono min-w-0 flex-1 truncate px-3 py-2 text-[12.5px]">{token.token}</code>
              <CopyButton text={token.token} />
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label mb-0">Client config</span>
              <CopyButton text={snippet} label="Copy config" />
            </div>
            <pre className="panel mono overflow-x-auto px-3.5 py-3 text-[12px] leading-[1.6] text-ink-2">{snippet}</pre>
          </div>
        </div>
      )}
      {error ? (
        <div className="mt-3">
          <ErrorBlock message={error} />
        </div>
      ) : null}
    </div>
  );
}

function ConnectTelegram() {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; bot: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setLink(await api<{ url: string; bot: string }>('/api/me/telegram', { body: {} }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-[14px] leading-[1.55] text-ink-2">
        Log bills from your group chat: add the bot, send <span className="mono">/link &lt;group code&gt;</span>, then start a bill with +. Same memory as here.
      </p>
      {!link ? (
        <button type="button" className="btn btn-ghost mt-4" onClick={() => void create()} disabled={busy}>
          {busy ? 'Creating…' : 'Link my Telegram'}
        </button>
      ) : (
        <div className="rise mt-4 flex flex-wrap items-center gap-3" aria-live="polite">
          <a className="btn btn-mem" href={link.url} target="_blank" rel="noreferrer">
            Open @{link.bot}
          </a>
          <span className="meta">The link works once.</span>
        </div>
      )}
      {error ? (
        <div className="mt-3">
          <ErrorBlock message={error} />
        </div>
      ) : null}
    </div>
  );
}

export function MeView() {
  const { me, state, tabKey, refresh } = useSession();
  const ex = useExplorer();

  if (state === 'loading') return <div className="pt-12"><LoadingBlock label="Loading your profile" /></div>;
  if (state === 'error') return <div className="pt-12"><ErrorBlock message="Couldn’t load your profile." onRetry={() => void refresh()} /></div>;
  if (state === 'anon' || !me?.user) return <SignInPrompt what="Your profile" />;

  const u = me.user;
  const groups = visibleGroups(me, tabKey);

  return (
    <div className="pt-8 md:pt-12">
      <div className="flex items-center gap-4">
        <Avatar name={u.name} size={52} active />
        <div className="min-w-0">
          <h1 className="h-page">{u.name}</h1>
          <p className="meta mt-1.5">{me.demo ? 'Demo flatmate, paying from a capped demo wallet' : 'Signed in with your wallet'}</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="addr-h" className="sheet p-5 sm:p-6">
          <h2 id="addr-h" className="h-sec">
            Sui address
          </h2>
          {u.suiAddress ? (
            <>
              <p className="mono mt-3 text-[13px] leading-[1.6] break-all text-ink">{u.suiAddress}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <CopyButton text={u.suiAddress} label="Copy address" />
                <ExtLink href={ex.account(u.suiAddress)} className="text-[12.5px]">
                  View on Suiscan
                </ExtLink>
              </div>
            </>
          ) : (
            <p className="mt-3 text-[14px] text-ink-2">No Sui address yet. Debts to and from you can’t be paid on-chain until there is one.</p>
          )}
          <div className="mt-5 rounded-[14px] bg-[rgba(242,236,228,.035)] px-4 py-3">
            <p className="text-[13.5px]">
              Learned auto-pay limit <Money micro={me.autoPayLimit} unit />
            </p>
            <p className="meta mt-1">Your agent pays up to this without asking, never past the mandate you signed in each group. Approvals raise it; objections halve it.</p>
          </div>
        </section>

        <section aria-labelledby="mine-h" className="sheet p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="mine-h" className="h-sec">
              My portable memory
            </h2>
            {u.ownMemory ? <span className="chip chip-mem">own account</span> : <span className="meta">in the Quits account</span>}
          </div>
          <p className="meta mt-1">Rules about you, applied in every group you join.</p>
          <div className="mt-3">
            <PortableMemory uid={u.id} groupIds={groups.map((g) => g.id)} />
          </div>
        </section>

        <section aria-labelledby="own-h" className="sheet p-5 sm:p-6">
          <h2 id="own-h" className="h-sec mb-2">
            Own your memory
          </h2>
          <OwnMemory demo={me.demo} current={u.memwalAccountId} onSaved={() => void refresh()} />
        </section>

        <section aria-labelledby="agent-h" className="sheet p-5 sm:p-6">
          <h2 id="agent-h" className="h-sec mb-2">
            Connect an agent
          </h2>
          <ConnectAgent />
        </section>

        <section aria-labelledby="tg-h" className="sheet p-5 sm:p-6">
          <h2 id="tg-h" className="h-sec mb-2">
            Telegram
          </h2>
          <ConnectTelegram />
        </section>
      </div>
    </div>
  );
}
