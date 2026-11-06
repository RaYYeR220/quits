'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, errorText } from './api.ts';
import { AutoSettle } from './autosettle.tsx';
import { Composer } from './composer.tsx';
import { initials, toMicro } from './format.ts';
import { History } from './history.tsx';
import { useSession } from './session.tsx';
import { SettleUp } from './settle.tsx';
import type { GroupData, ListedRule } from './types.ts';
import { Avatar, ErrorBlock, LoadingBlock, Money, SignInPrompt } from './ui.tsx';

function Standing({ micro }: { micro: string }) {
  const v = toMicro(micro);
  if (v === 0n) return <span className="text-[13px] text-ink-3">settled up</span>;
  return (
    <span className="text-[13px] text-ink-2">
      {v > 0n ? 'is owed ' : 'owes '}
      <Money micro={v > 0n ? v : -v} className={v > 0n ? 'text-ink' : 'text-ink-2'} />
    </span>
  );
}

export function useGroup(id: string) {
  const { me, state } = useSession();
  const [data, setData] = useState<GroupData | null>(null);
  const [rules, setRules] = useState<ListedRule[] | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const uid = me?.user?.id;

  const load = useCallback(async () => {
    try {
      const d = await api<GroupData>(`/api/groups/${id}`);
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError({ status: e instanceof ApiError ? e.status : 0, message: errorText(e) });
      return null;
    }
  }, [id]);

  const loadRules = useCallback(async () => {
    try {
      const r = await api<{ rules: ListedRule[] }>(`/api/groups/${id}/rules`);
      setRules(r.rules);
    } catch {
      /* rules are an enhancement on this screen */
    }
  }, [id]);

  useEffect(() => {
    if (!uid) return;
    void load();
    void loadRules();
  }, [uid, load, loadRules]);

  return { data, rules, setRules, error, load, loadRules, sessionState: state };
}

export function GroupView({ id }: { id: string }) {
  const { me, refresh } = useSession();
  const { data, rules, error, load, loadRules, sessionState } = useGroup(id);

  const ruleMap = useMemo(() => new Map((rules ?? []).map((r) => [r.id, r])), [rules]);
  const nameOf = useCallback((uid: string) => data?.members.find((m) => m.id === uid)?.name ?? null, [data]);
  const ownerOf = useCallback(
    (ruleId: string) => {
      const r = ruleMap.get(ruleId);
      return r?.scope === 'member' && r.ownerId ? (nameOf(r.ownerId) ?? null) : null;
    },
    [ruleMap, nameOf],
  );

  const onChanged = useCallback(() => {
    void load();
    void refresh();
  }, [load, refresh]);

  // While the agent may be recording or paying, keep the screen current.
  useEffect(() => {
    if (!data) return;
    const mine = data.members.find((m) => m.id === data.me);
    const active = data.debts.some((d) => d.status === 'recorded') || (mine?.autoSettle && data.debts.some((d) => d.debtorId === data.me));
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => clearInterval(t);
  }, [data, load]);

  if (sessionState === 'anon') return <SignInPrompt what="This group" />;
  if (error && (!data || data.me !== me?.user?.id)) {
    if (error.status === 401) return <SignInPrompt what="This group" />;
    return (
      <div className="mx-auto mt-16 max-w-xl">
        <ErrorBlock
          message={error.status === 403 ? `${me?.user?.name ?? 'You'} isn’t in this group. Switch flatmates or pick another group.` : error.status === 404 ? 'There’s no group here.' : error.message}
          onRetry={error.status >= 500 || error.status === 0 ? () => void load() : undefined}
        />
        <Link href="/app" className="link mt-4 inline-block text-[14px]">
          Back to your groups
        </Link>
      </div>
    );
  }
  if (!data) return <div className="pt-12"><LoadingBlock label="Loading the group" rows={4} /></div>;

  const limit = toMicro(me?.autoPayLimit ?? '5000000');
  const active = (rules ?? []).filter((r) => r.status === 'active').length;

  return (
    <div className="pt-6 md:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="tile h-12 w-12 rounded-[14px] text-[14px]">{initials(data.group.name)}</span>
          <div className="min-w-0">
            <h1 className="h-page truncate">{data.group.name}</h1>
            <p className="meta mt-1.5">
              Bills in {data.group.defaultCurrency}, settled in USDC on Sui
              {!data.group.isDemo ? ` · invite code ${data.group.code}` : ''}
            </p>
          </div>
        </div>
        <Link href={`/g/${data.group.id}/rules`} className="btn btn-ghost">
          What Quits has learned
          {rules ? <span className="chip chip-mem">{active}</span> : null}
        </Link>
      </header>

      <section aria-label="Members and balances" className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-line bg-line md:grid-cols-4">
        {data.members.map((m) => (
          <div key={m.id} className="bg-card px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2.5">
              <Avatar name={m.name} size={30} active={m.id === data.me} />
              <span className="truncate text-[14.5px] font-semibold">{m.name}</span>
              {m.id === data.me ? <span className="meta">you</span> : null}
            </div>
            <div className="mt-2">
              <Standing micro={data.balances[m.id] ?? '0'} />
            </div>
            {m.ownMemory || m.autoSettle ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.ownMemory ? <span className="chip chip-mem">own memory</span> : null}
                {m.autoSettle ? <span className="chip chip-solid">auto-settle on</span> : null}
              </div>
            ) : null}
          </div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <div className="lg:col-start-1 lg:row-start-1">
          <Composer
            data={data}
            ownerOf={ownerOf}
            onPosted={onChanged}
            onLearned={() => void loadRules()}
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <SettleUp data={data} limit={limit} onChanged={onChanged} />
          <AutoSettle data={data} limit={limit} onChanged={onChanged} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <History data={data} rules={ruleMap} />
        </div>
      </div>
    </div>
  );
}
