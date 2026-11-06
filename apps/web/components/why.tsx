'use client';

import { day, toMicro, usdc, walrusUrl } from './format.ts';
import type { Member, Split, Why } from './types.ts';
import { Avatar, ExtLink, Money } from './ui.tsx';

const STATE: Record<Why['state'], { text: string; cls: string; title: string }> = {
  stored: { text: 'stored on Walrus', cls: 'text-ink-2', title: 'Read back from Walrus Memory for this split' },
  saving: { text: 'saving to Walrus', cls: 'text-warn', title: 'Learned moments ago; the Walrus write is still landing' },
  cached: { text: 'cached', cls: 'text-ink-3', title: 'Not returned by Walrus this time, so the copy kept here was used' },
};

export function BlobRef({ blobId }: { blobId: string | null | undefined }) {
  if (!blobId) return null;
  const url = walrusUrl(blobId);
  const label = blobId.length > 18 ? `${blobId.slice(0, 8)}…${blobId.slice(-6)}` : blobId;
  return url ? (
    <ExtLink href={url} label={`Walrus blob ${blobId}`}>
      blob {label}
    </ExtLink>
  ) : (
    <span title="Kept by the local memory stand-in; no public Walrus page">blob {label}</span>
  );
}

/** One remembered rule that shaped a split: the sentence, when it was learned, where it lives. */
export function WhyChip({ w, owner }: { w: Why; owner?: string | null }) {
  const st = STATE[w.state];
  const where = w.scope === 'member' ? (owner ? `from ${owner}’s memory` : 'from a member’s own memory') : 'group rule';
  const on = w.appliesTo.filter((a) => a !== 'whole expense');
  return (
    <li className="why">
      <div className="flex gap-3">
        <span className="mono w-[46px] flex-none pt-[3px] text-[11.5px] text-mem" title={`Learned ${day(w.learnedAt)}`}>
          <span className="sr-only">Learned </span>
          {day(w.learnedAt)}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] leading-[1.42] text-ink">{w.sentence}</p>
          <p className="mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
            <span className={w.scope === 'member' ? 'text-mem' : ''}>{where}</span>
            <span aria-hidden="true">·</span>
            <span>learned {day(w.learnedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className={st.cls} title={st.title}>
              {st.text}
            </span>
            {w.blobId ? (
              <>
                <span aria-hidden="true">·</span>
                <BlobRef blobId={w.blobId} />
              </>
            ) : null}
            {on.length ? (
              <>
                <span aria-hidden="true">·</span>
                <span>on {on.join(', ')}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </li>
  );
}

export function WhyList({ split, ownerOf, empty = 'Split evenly. Nothing remembered for this yet.' }: { split: Split; ownerOf: (ruleId: string) => string | null; empty?: string }) {
  if (split.why.length === 0) return <p className="text-[13.5px] text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Why it’s split this way">
      {split.why.map((w) => (
        <WhyChip key={w.ruleId} w={w} owner={ownerOf(w.ruleId)} />
      ))}
    </ul>
  );
}

/** Even split of the total among participants, for showing what memory changed. */
export function evenShare(split: Split): bigint {
  const n = BigInt(Math.max(1, split.expense.participants.length));
  return toMicro(split.expense.usdcMicro) / n;
}

export function changedByMemory(split: Split, memberId: string): boolean {
  if (split.why.length === 0 || !split.expense.participants.includes(memberId)) return false;
  const diff = toMicro(split.shares[memberId] ?? '0') - evenShare(split);
  const tol = BigInt(split.expense.participants.length);
  return diff > tol || diff < -tol;
}

/** Per-member shares; amounts memory moved are lavender with the even split struck beside them. */
export function SplitRows({ split, members, meId, compare }: { split: Split; members: Member[]; meId: string; compare?: Split | null }) {
  const even = evenShare(split);
  return (
    <ul className="divide-y divide-line" aria-label="Shares">
      {members.map((m) => {
        const inIt = split.expense.participants.includes(m.id);
        const share = toMicro(split.shares[m.id] ?? '0');
        const moved = changedByMemory(split, m.id);
        const before = compare ? toMicro(compare.shares[m.id] ?? '0') : null;
        const delta = before !== null ? share - before : 0n;
        const paid = split.expense.payerId === m.id;
        const note = !inIt ? 'not in this one' : paid ? 'paid' : share === 0n && moved ? 'nothing to pay' : '';
        return (
          <li key={m.id} className={`grid h-[50px] grid-cols-[36px_1fr_auto] items-center ${inIt ? '' : 'opacity-45'}`}>
            <Avatar name={m.name} />
            <span className="min-w-0">
              <b className="text-[14.5px] font-semibold">{m.name}</b>
              {m.id === meId ? <span className="meta ml-1.5">you</span> : null}
              {note ? <span className={`block text-[12px] ${note === 'nothing to pay' ? 'text-mem' : 'text-ink-3'}`}>{note}</span> : null}
            </span>
            <span className="flex items-baseline gap-2 text-right">
              {compare && delta !== 0n ? (
                <Money micro={delta} signed className="text-[12px] text-mem" />
              ) : moved && !compare ? (
                <s className="money text-[12px] text-ink-3" title="Even split">
                  <span className="sr-only">even split </span>
                  {usdc(even)}
                </s>
              ) : null}
              {inIt ? <Money micro={share} className={`text-[15px] ${moved || (compare && delta !== 0n) ? 'text-mem' : ''}`} /> : <span className="money text-ink-3">—</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
