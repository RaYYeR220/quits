import { MICRO_PER_USDC, type Micro } from '@quits/core';
import { elapsedSince, noopCallLog, recordCall, type CallLog } from './calllog.ts';
import { TATUM_API_URL } from './config.ts';
import { sharedLimiter, type Limiter } from './limiter.ts';

export type FxFailure = 'unknown_currency' | 'network' | 'http_error' | 'bad_response' | 'stale';

/** The expense cannot be priced in USDC. Callers must ask for a USD amount, never guess a rate. */
export class FxUnavailableError extends Error {
  override name = 'FxUnavailableError';

  constructor(
    readonly currency: string,
    readonly reason: FxFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class TatumDataError extends Error {
  override name = 'TatumDataError';

  constructor(
    readonly endpoint: string,
    readonly status: number | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface FxRate {
  /** USDC for one unit of the fiat currency, as a decimal string. */
  rate: string;
  source: 'tatum';
  /** When Tatum says the rate was valid (ISO 8601). */
  at: string;
}

export interface TatumData {
  /**
   * Current USDC price of one unit of `fiat` (ISO 4217). Tatum only serves the
   * latest rate, so `at` does not change the query. Throws `FxUnavailableError`
   * on any failure.
   */
  usdcPerFiat(fiat: string, at?: Date): Promise<FxRate>;
  /** Stores a file on Walrus mainnet through Tatum's storage API (mainnet keys only). */
  uploadToWalrus(bytes: Uint8Array, contentType: string, filename?: string): Promise<{ blobId: string; jobId: string }>;
}

export interface TatumDataOptions {
  apiKey: string;
  log?: CallLog;
  limiter?: Limiter | null;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** How long a fetched rate is reused. */
  cacheMs?: number;
  /** Rates older than this are refused. Fiat sources pause over weekends, hence three days. */
  maxAgeMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

const RATE_DECIMALS = 12;
const DECIMAL = /^\d+(\.\d+)?$/;

export function createTatumData({
  apiKey,
  log = noopCallLog,
  limiter,
  fetch: fetchFn = fetch,
  baseUrl = TATUM_API_URL,
  cacheMs = 60_000,
  maxAgeMs = 3 * 24 * 3600_000,
  timeoutMs = 8_000,
  now = Date.now,
}: TatumDataOptions): TatumData {
  const throttle = limiter !== undefined ? limiter : sharedLimiter(apiKey);
  const cache = new Map<string, { fx: FxRate; fetchedAt: number }>();

  async function call(path: string, init: RequestInit): Promise<Response> {
    if (throttle) await throttle.take();
    const method = path.split('?')[0]!;
    const headers = new Headers(init.headers);
    headers.set('x-api-key', apiKey);
    const t0 = performance.now();
    try {
      const res = await fetchFn(`${baseUrl}/v4/data/${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
      recordCall(log, { surface: 'data', method, ms: elapsedSince(t0), ok: res.ok, ...(res.ok ? {} : { code: String(res.status) }) });
      return res;
    } catch (err) {
      recordCall(log, { surface: 'data', method, ms: elapsedSince(t0), ok: false });
      throw err;
    }
  }

  return {
    async usdcPerFiat(fiat) {
      const code = fiat.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) throw new FxUnavailableError(code, 'unknown_currency', `Not a currency code: ${fiat}`);

      const hit = cache.get(code);
      if (hit && now() - hit.fetchedAt < cacheMs) return hit.fx;

      let res: Response;
      try {
        res = await call(`rate/symbol?symbol=USDC&basePair=${code}`, { headers: { accept: 'application/json' } });
      } catch (err) {
        throw new FxUnavailableError(code, 'network', `Tatum rate API unreachable for ${code}`, { cause: err });
      }
      if (!res.ok) throw new FxUnavailableError(code, 'http_error', `Tatum rate API answered ${res.status} for ${code}`);

      let body: { value?: unknown; basePair?: unknown; symbol?: unknown; timestamp?: unknown };
      try {
        body = (await res.json()) as typeof body;
      } catch (err) {
        throw new FxUnavailableError(code, 'bad_response', `Tatum rate API sent invalid JSON for ${code}`, { cause: err });
      }

      const { value, basePair, symbol, timestamp } = body;
      if (basePair !== code || (symbol !== undefined && symbol !== 'USDC')) {
        throw new FxUnavailableError(code, 'bad_response', `Tatum returned a rate for ${String(symbol)}/${String(basePair)}, not USDC/${code}`);
      }
      if (typeof value !== 'string' || !DECIMAL.test(value) || isZero(value)) {
        throw new FxUnavailableError(code, 'bad_response', `Tatum returned an unusable rate for ${code}: ${String(value)}`);
      }
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
        throw new FxUnavailableError(code, 'bad_response', `Tatum rate for ${code} has no timestamp`);
      }
      const atMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
      if (now() - atMs > maxAgeMs) {
        throw new FxUnavailableError(code, 'stale', `Tatum rate for ${code} is from ${new Date(atMs).toISOString()}`);
      }

      const fx: FxRate = { rate: invertDecimal(value, RATE_DECIMALS), source: 'tatum', at: new Date(atMs).toISOString() };
      cache.set(code, { fx, fetchedAt: now() });
      return fx;
    },

    async uploadToWalrus(bytes, contentType, filename = 'upload') {
      const form = new FormData();
      form.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }), filename);
      let res: Response;
      try {
        res = await call('storage/upload', { method: 'POST', body: form });
      } catch (err) {
        throw new TatumDataError('storage/upload', null, 'Tatum storage API unreachable', { cause: err });
      }
      const body = (await res.json().catch(() => null)) as { jobId?: unknown; blobId?: unknown; message?: unknown } | null;
      if (!res.ok) {
        throw new TatumDataError('storage/upload', res.status, `Tatum storage upload failed (${res.status}): ${String(body?.message ?? '')}`);
      }
      if (typeof body?.blobId !== 'string' || typeof body.jobId !== 'string') {
        throw new TatumDataError('storage/upload', res.status, 'Tatum storage upload returned no blob id');
      }
      return { blobId: body.blobId, jobId: body.jobId };
    },
  };
}

/**
 * Prices `amountMinor` (minor units of the fiat, e.g. cents) in micro-USDC at
 * `rate` USDC per fiat unit, with one half-up rounding at the end.
 */
export function fiatToMicro(amountMinor: bigint, rate: string, minorUnits = 2): Micro {
  if (!DECIMAL.test(rate) || isZero(rate)) throw new FxUnavailableError('', 'bad_response', `Unusable rate: ${rate}`);
  const [digits, scale] = scaled(rate);
  const num = (amountMinor < 0n ? -amountMinor : amountMinor) * digits * MICRO_PER_USDC;
  const den = 10n ** BigInt(scale + minorUnits);
  const micro = (2n * num + den) / (2n * den);
  return amountMinor < 0n ? -micro : micro;
}

function scaled(decimal: string): [bigint, number] {
  const [whole = '0', frac = ''] = decimal.split('.');
  return [BigInt(whole + frac), frac.length];
}

function isZero(decimal: string): boolean {
  return scaled(decimal)[0] === 0n;
}

/** `1 / value`, rounded half-up to `decimals` places, trailing zeros trimmed. */
function invertDecimal(value: string, decimals: number): string {
  const [digits, scale] = scaled(value);
  const num = 10n ** BigInt(scale + decimals);
  const q = (2n * num + digits) / (2n * digits);
  const s = q.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
