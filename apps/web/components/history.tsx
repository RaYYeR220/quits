'use client';

import { useState } from 'react';
import { dayTime, fiat, toMicro } from './format.ts';
import type { GroupData, ListedRule } from './types.ts';
import { Money } from './ui.tsx';

export function RuleTag({ sentence, owner }: { sentence: string; owner?: string | null }) {
  return (
    <span className="inline-flex max-w-full items-start gap-2 rounded-[10px] border border-[rgba(185,168,255,.3)] bg-mem-3 px-2.5 py-1 text-[12.5px] leading-[1.4] text-ink">
      <span aria-hidden="true" className="mt-[7px] h-[3px] w-2.5 flex-none rounded-full bg-mem" />
      <span>
        {sentence}
        {owner ? <span className="text-mem"> · {owner}’s memory</span> : null}
      </span>
    </span>
  );
}

export function History({ data, rules }: { data: GroupData; rules: Map<string, ListedRule> }) {
  const [all, setAll] = useState(false);
  const name = (id: string) => data.members.find((m) => m.id === id)?.name ?? 'someone';
  const list = all ? data.expenses : data.expenses.slice(0, 8);

  return (
    <section aria-labelledby="hist-h" className="sheet p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="hist-h" className="h-sec">
          Bills
        </h2>
        <span className="meta">{data.expenses.length} posted</span>
      </div>
      {data.expenses.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-2">No bills yet. Log the first one above in plain words.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {list.map((h) => {
            const e = h.expense;
            const ruleIds = [...new Set(h.applied.map((a) => a.ruleId))];
            return (
              <li key={e.id} className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-semibold tracking-[-0.01em]">{e.description}</p>
                    <p className="meta mt-0.5">
                      {name(e.payerId)} paid · {dayTime(e.occurredAt)}
                      {e.currency !== 'USD' && e.currency !== 'USDC' ? ` · ${fiat(e.amountMinor, e.currency)}` : ''}
                    </p>
                  </div>
                  <Money micro={e.usdcMicro} className="pt-0.5 text-[14.5px]" />
                </div>
                <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1" aria-label={`Shares of ${e.description}`}>
                  {data.members
                    .filter((m) => e.participants.includes(m.id))
                    .map((m) => {
                      const v = toMicro(h.shares[m.id] ?? '0');
                      return (
                        <li key={m.id} className="text-[12.5px] text-ink-3">
                          {m.name} <Money micro={v} className={v === 0n ? 'text-ink-3' : 'text-ink-2'} />
                        </li>
                      );
                    })}
                </ul>
                {ruleIds.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ruleIds.map((id) => {
                      const r = rules.get(id);
                      return r ? <RuleTag key={id} sentence={r.sentence} owner={r.scope === 'member' && r.ownerId ? name(r.ownerId) : null} /> : null;
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {data.expenses.length > 8 ? (
        <button type="button" className="btn btn-quiet mt-2 text-[13px]" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${data.expenses.length}`}
        </button>
      ) : null}
    </section>
  );
}
