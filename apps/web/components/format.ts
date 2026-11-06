import type { Micro } from './types.ts';

const MICRO = 1_000_000n;

export function toMicro(v: Micro | bigint | number | null | undefined): bigint {
  if (typeof v === 'bigint') return v;
  try {
    return BigInt(v ?? 0);
  } catch {
    return 0n;
  }
}

/** micro-USDC → "1,234.56" (truncated like the ledger's own sentences). */
export function usdc(v: Micro | bigint | null | undefined, decimals = 2): string {
  const m = toMicro(v);
  const neg = m < 0n;
  const a = neg ? -m : m;
  const whole = (a / MICRO).toLocaleString('en-US');
  const frac = (a % MICRO).toString().padStart(6, '0').slice(0, decimals);
  return `${neg ? '−' : ''}${whole}${decimals > 0 ? `.${frac}` : ''}`;
}

/** Full precision, for titles: "2.466666". */
export const usdcFull = (v: Micro | bigint | null | undefined) => usdc(v, 6);

export function fiatDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Original amount in its own currency: "412.00 PLN". */
export function fiat(amountMinor: string, currency: string): string {
  const d = fiatDigits(currency);
  const m = toMicro(amountMinor);
  const base = 10n ** BigInt(d);
  const whole = (m / base).toLocaleString('en-US');
  const frac = d > 0 ? `.${(m % base).toString().padStart(d, '0')}` : '';
  return `${whole}${frac} ${currency}`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function dayTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return day(iso);
}

export function short(id: string | null | undefined, head = 6, tail = 4): string {
  if (!id) return '';
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0]!;
    const digits = w.match(/\d+[A-Za-z]?/)?.[0];
    return (digits ?? w.slice(0, 2)).toUpperCase().slice(0, 3);
  }
  const last = words[words.length - 1]!;
  if (/\d/.test(last)) return last.toUpperCase().slice(0, 3);
  return (words[0]![0]! + last[0]!).toUpperCase();
}

/** Walrus blobs from the local stand-in have no public page. */
export const walrusUrl = (blobId: string | null | undefined) => (blobId && !blobId.startsWith('mock-') ? `https://walruscan.com/mainnet/blob/${blobId}` : null);

export const SANDBOX_PREFIX = 'demo-tab-';
