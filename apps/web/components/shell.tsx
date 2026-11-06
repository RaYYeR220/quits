'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorText } from './api.ts';
import { DEMO_NAMES, useSession } from './session.tsx';
import { Avatar, Mark } from './ui.tsx';

const NAV = [
  { href: '/app', label: 'Groups', match: (p: string) => p === '/app' || p.startsWith('/g/') },
  { href: '/proof', label: 'Proof', match: (p: string) => p.startsWith('/proof') },
  { href: '/me', label: 'Me', match: (p: string) => p.startsWith('/me') },
];

function MemberSwitcher({ compact = false }: { compact?: boolean }) {
  const { me, startDemo, switching } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const current = me?.user?.name;

  async function pick(name: string) {
    if (name === current || switching) return;
    setError(null);
    try {
      const r = await startDemo(name);
      if (!pathname.startsWith('/g/') && pathname !== '/me' && pathname !== '/app') router.push(`/g/${r.tab}`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span id={compact ? 'acting-as-m' : 'acting-as'} className="meta whitespace-nowrap">
        Acting as
      </span>
      <div role="radiogroup" aria-labelledby={compact ? 'acting-as-m' : 'acting-as'} className="flex items-center gap-0.5 rounded-full border border-line p-0.5">
        {DEMO_NAMES.map((n) => {
          const on = n === current;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={n}
              disabled={Boolean(switching)}
              onClick={() => void pick(n)}
              className={`flex h-8 items-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors ${on ? 'pr-2.5 pl-0.5' : compact ? 'px-0.5' : 'px-0.5 lg:pr-2.5'} ${
                on ? 'bg-[rgba(242,236,228,.08)] text-ink' : 'text-ink-3 hover:text-ink-2'
              } ${switching === n ? 'opacity-60' : ''}`}
            >
              <Avatar name={n} size={26} active={on} />
              <span className={on ? '' : compact ? 'hidden' : 'hidden lg:inline'}>{n}</span>
            </button>
          );
        })}
      </div>
      <span aria-live="polite" className="sr-only">
        {switching ? `Switching to ${switching}` : current ? `Acting as ${current}` : ''}
      </span>
      {error ? (
        <span role="alert" className="text-[12.5px] text-warn">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, state, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const signedIn = state === 'ready' && me;

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <div className="pool pool-a" aria-hidden="true" />
      <div className="pool pool-b" aria-hidden="true" />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-bg">
        Skip to content
      </a>
      <header className="wrap">
        <div className="flex h-[68px] items-center gap-3 sm:gap-7">
          <Link href={signedIn ? '/app' : '/'} className="flex items-center gap-2.5 rounded-md text-[18px] font-semibold tracking-[-0.02em]">
            <Mark />
            <span>Quits</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-0.5">
            {NAV.map((n) => {
              const on = n.match(pathname);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? 'page' : undefined}
                  className={`rounded-full px-2.5 py-1.5 text-[14px] transition-colors sm:px-3 ${on ? 'bg-[rgba(242,236,228,.07)] text-ink' : 'text-ink-2 hover:text-ink'}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            {signedIn && me.demo ? (
              <div className="hidden sm:block">
                <MemberSwitcher />
              </div>
            ) : null}
            {signedIn ? (
              <button
                type="button"
                className="btn-quiet btn text-[13.5px]"
                onClick={async () => {
                  await signOut();
                  router.push('/demo');
                }}
              >
                Sign out
              </button>
            ) : state === 'anon' && pathname !== '/demo' ? (
              <Link href="/demo" className="btn btn-ghost btn-sm">
                Try the demo
              </Link>
            ) : null}
          </div>
        </div>
        {signedIn && me.demo ? (
          <div className="flex items-center pb-3 sm:hidden">
            <MemberSwitcher compact />
          </div>
        ) : null}
      </header>
      <main id="main" className="wrap pb-24">
        {children}
      </main>
    </>
  );
}
