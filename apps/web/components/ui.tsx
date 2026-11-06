'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { initial, usdc, usdcFull } from './format.ts';
import type { Micro } from './types.ts';

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 12) / 18} viewBox="0 0 18 12" aria-hidden="true">
      <rect width="18" height="3" rx="1.5" fill="#f2ece4" />
      <rect y="9" width="18" height="3" rx="1.5" fill="#b9a8ff" />
    </svg>
  );
}

export function Avatar({ name, size = 28, active = false, className = '' }: { name: string; size?: number; active?: boolean; className?: string }) {
  return (
    <span
      className={`avatar ${className}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.43),
        ...(active ? { borderColor: 'var(--color-ink)', color: 'var(--color-ink)' } : {}),
      }}
    >
      {initial(name)}
    </span>
  );
}

/** Money in USDC: two decimals on screen, full precision on hover. */
export function Money({ micro, unit = false, className = '', signed = false }: { micro: Micro | bigint; unit?: boolean; className?: string; signed?: boolean }) {
  const v = typeof micro === 'bigint' ? micro : BigInt(micro || '0');
  const text = signed && v > 0n ? `+${usdc(v)}` : usdc(v);
  return (
    <span className={`money ${className}`} title={`${usdcFull(v)} USDC`}>
      {text}
      {unit ? <span className="unit">USDC</span> : null}
    </span>
  );
}

function ArrowOut() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" className="flex-none opacity-70">
      <path d="M3 1.5h5.5V7M8.5 1.5 1.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function ExtLink({ href, children, className = '', label }: { href: string; children: React.ReactNode; className?: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`xlink ${className}`} aria-label={label}>
      {children}
      <ArrowOut />
    </a>
  );
}

export function Notice({ children, tone = 'info', className = '' }: { children: React.ReactNode; tone?: 'info' | 'warn'; className?: string }) {
  return <div className={`notice ${tone === 'warn' ? 'notice-warn' : ''} ${className}`}>{children}</div>;
}

export function Skeleton({ h = 18, w = '100%', className = '' }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w }} aria-hidden="true" />;
}

export function LoadingBlock({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={i === 0 ? 26 : 52} w={i === 0 ? '40%' : '100%'} />
      ))}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [done]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setDone(true);
      } finally {
        ta.remove();
      }
    }
  }
  return (
    <button type="button" onClick={copy} className={`btn btn-ghost btn-sm ${className}`}>
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </button>
  );
}

/** Seconds left until `to`, ticking once a second. */
export function useCountdown(to: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  if (!to) return null;
  return Math.max(0, Math.ceil((new Date(to).getTime() - now) / 1000));
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function SignInPrompt({ what }: { what: string }) {
  return (
    <div className="sheet mx-auto mt-16 max-w-xl p-8">
      <h1 className="h-sec">{what} needs a session</h1>
      <p className="lede mt-2">
        Wallet sign-in is on its way. Until then, try Quits as one of four flatmates with real debts settled on Sui.
      </p>
      <Link href="/demo" className="btn btn-mem btn-lg mt-6">
        Try the demo
      </Link>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="notice notice-warn flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
