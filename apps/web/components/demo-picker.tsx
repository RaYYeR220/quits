'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from './api.ts';
import { SANDBOX_PREFIX, usdc } from './format.ts';
import { useSession } from './session.tsx';
import { Avatar, ErrorBlock } from './ui.tsx';

// What each flatmate's memory already holds in the seeded flat (see packages/service/src/demo.ts).
const PEOPLE = [
  { name: 'Ana', carries: 'Doesn’t drink. Her own memory keeps her out of alcohol in every group she joins.' },
  { name: 'Ben', carries: 'Always covers the taxis. One correction taught the flat that rule.' },
  { name: 'Clara', carries: 'Vegetarian. No meat on her share, wherever the bill comes from.' },
  { name: 'Dan', carries: 'Not on the streaming account, so subscriptions skip him.' },
];

export function DemoPicker() {
  const { me, startDemo, switching, tabKey, demoTerms } = useSession();
  const router = useRouter();
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(name: string) {
    setError(null);
    try {
      const r = await startDemo(name, { fresh });
      router.push(`/g/${r.tab}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="grid grid-cols-1 gap-10 pt-8 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
      <div className="rise">
        <h1 className="h-page max-w-[13em]">Try Quits as one of the flatmates</h1>
        <p className="lede mt-5">
          Ana, Ben, Clara and Dan share Flat 5B in Kraków. Pick who you are. You get your own Coffee tab with small USDC debts that settle for real on Sui, plus the flat’s three weeks of history to look around in.
        </p>
        <p className="meta mt-4">No sign-in and no wallet. Each flatmate pays from a small demo wallet capped at {usdc(demoTerms.maxPerDebt)} USDC per debt.</p>
        <ol className="mt-10 flex max-w-[30em] flex-col gap-3 border-t border-line pt-6 text-[14px] text-ink-2">
          {[
            'Log a bill in plain words and see the reasons behind its split.',
            'Fix it once. Quits keeps the lesson for every bill after.',
            'Pay a debt. Watch the 402 and the receipt land on Sui.',
            'Let your agent settle the rest within limits you sign.',
            'Replay a bill as Quits saw it on day one.',
          ].map((s, i) => (
            <li key={i} className="grid grid-cols-[22px_1fr] gap-2">
              <span className="mono pt-px text-[12px] text-ink-3">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        {me?.demo && me.user && tabKey ? (
          <p className="mt-6 text-[14px] text-ink-2">
            You’re acting as {me.user.name}.{' '}
            <Link className="link" href={`/g/${SANDBOX_PREFIX}${tabKey}`}>
              Back to your Coffee tab
            </Link>
          </p>
        ) : null}
      </div>

      <div className="rise" style={{ animationDelay: '60ms' }}>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Flatmates">
          {PEOPLE.map((p) => {
            const busy = switching === p.name;
            return (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => void pick(p.name)}
                  disabled={Boolean(switching)}
                  aria-busy={busy}
                  className="card group flex h-full w-full flex-col items-start gap-4 p-5 text-left transition-[border-color] duration-200 hover:border-[rgba(242,236,228,.3)] disabled:cursor-wait"
                >
                  <span className="flex w-full items-center gap-3">
                    <Avatar name={p.name} size={40} />
                    <span className="text-[17px] font-semibold tracking-[-0.02em]">{p.name}</span>
                    <span className="ml-auto text-[13px] text-ink-3 transition-colors group-hover:text-ink">{busy ? 'Opening…' : `Be ${p.name}`}</span>
                  </span>
                  <span className="flex gap-2.5 text-[13.5px] leading-[1.5] text-ink-2">
                    <span aria-hidden="true" className="mt-[7px] h-[3px] w-3 flex-none rounded-full bg-mem" />
                    {p.carries}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {tabKey ? (
          <label className="mt-4 flex items-center gap-2.5 text-[13.5px] text-ink-2">
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} className="size-4 accent-[#b9a8ff]" />
            Start a fresh Coffee tab instead of reopening yours
          </label>
        ) : null}
        <div aria-live="polite" className="mt-4">
          {error ? <ErrorBlock message={error} /> : null}
        </div>
      </div>
    </section>
  );
}
