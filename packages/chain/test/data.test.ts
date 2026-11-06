import { describe, expect, it, vi } from 'vitest';
import { createMemoryCallLog } from '../src/calllog.ts';
import { createTatumData, fiatToMicro, FxUnavailableError, TatumDataError } from '../src/tatum-data.ts';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function rateBody(over: Record<string, unknown> = {}) {
  return { value: '0.92', basePair: 'EUR', timestamp: NOW - 60_000, source: 'fixer.io', symbol: 'USDC', ...over };
}

function setup(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(fetchImpl);
  const log = createMemoryCallLog();
  const data = createTatumData({ apiKey: 'k-test', log, fetch: fetch as typeof globalThis.fetch, now: () => NOW, limiter: null });
  return { data, fetch, log };
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

describe('tatum exchange rate', () => {
  it('returns USDC per unit of fiat from the Tatum rate endpoint', async () => {
    const { data, fetch, log } = setup(async () => jsonResponse(rateBody()));

    const fx = await data.usdcPerFiat('eur');

    expect(fx).toEqual({ rate: '1.086956521739', source: 'tatum', at: new Date(NOW - 60_000).toISOString() });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.tatum.io/v4/data/rate/symbol?symbol=USDC&basePair=EUR');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('k-test');
    expect(log.calls()).toEqual([expect.objectContaining({ surface: 'data', method: 'rate/symbol', ok: true })]);
  });

  it('fx_unknown_currency_throws_FxUnavailable', async () => {
    const { data, fetch } = setup(async () =>
      jsonResponse({ statusCode: 400, errorCode: 'validation.failed', message: 'basePair must be a valid enum value' }, 400),
    );

    const err = await rejection(data.usdcPerFiat('ZZZ'));
    expect(err).toBeInstanceOf(FxUnavailableError);
    expect(err).toMatchObject({ currency: 'ZZZ', reason: 'http_error' });

    const bad = await rejection(data.usdcPerFiat('euro'));
    expect(bad).toMatchObject({ name: 'FxUnavailableError', reason: 'unknown_currency' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fx_http_error_throws', async () => {
    const { data, log } = setup(async () => new Response('upstream down', { status: 503 }));

    const err = await rejection(data.usdcPerFiat('EUR'));
    expect(err).toBeInstanceOf(FxUnavailableError);
    expect(err).toMatchObject({ reason: 'http_error' });
    expect(log.calls()).toEqual([expect.objectContaining({ surface: 'data', ok: false, code: '503' })]);
  });

  it('throws FxUnavailable when the network call fails', async () => {
    const { data } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await rejection(data.usdcPerFiat('EUR'))).toMatchObject({ name: 'FxUnavailableError', reason: 'network' });
  });

  it.each([
    ['zero rate', rateBody({ value: '0' })],
    ['non-decimal rate', rateBody({ value: '1e-3' })],
    ['missing rate', rateBody({ value: undefined })],
    ['rate for another base pair', rateBody({ basePair: 'USD' })],
    ['rate for another symbol', rateBody({ symbol: 'USDT' })],
  ])('never prices from a bad response (%s)', async (_label, body) => {
    const { data } = setup(async () => jsonResponse(body));
    expect(await rejection(data.usdcPerFiat('EUR'))).toMatchObject({ name: 'FxUnavailableError', reason: 'bad_response' });
  });

  it('rejects a stale rate', async () => {
    const { data } = setup(async () => jsonResponse(rateBody({ timestamp: NOW - 5 * 24 * 3600_000 })));
    expect(await rejection(data.usdcPerFiat('EUR'))).toMatchObject({ name: 'FxUnavailableError', reason: 'stale' });
  });

  it('caches a rate per currency for a short while', async () => {
    const { data, fetch } = setup(async () => jsonResponse(rateBody()));
    await data.usdcPerFiat('EUR');
    await data.usdcPerFiat('EUR');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('fiatToMicro', () => {
  it('converts minor units with a single half-up rounding', () => {
    expect(fiatToMicro(8_400n, '1.086956521739')).toBe(91_304_348n);
    expect(fiatToMicro(100n, '1')).toBe(1_000_000n);
    expect(fiatToMicro(1_500n, '0.006667', 0)).toBe(10_000_500n);
  });

  it('refuses a malformed rate', () => {
    expect(() => fiatToMicro(100n, 'abc')).toThrow(FxUnavailableError);
    expect(() => fiatToMicro(100n, '0')).toThrow(FxUnavailableError);
  });
});

describe('tatum walrus storage', () => {
  it('uploads a file as multipart and returns the blob id', async () => {
    const { data, fetch, log } = setup(async () =>
      jsonResponse({ jobId: '68000000000000000000abcd', status: 'PENDING', filename: 'receipt.jpg', sizeBytes: 3, blobId: 'mAlStJ4P' }),
    );

    const res = await data.uploadToWalrus(new Uint8Array([1, 2, 3]), 'image/jpeg', 'receipt.jpg');

    expect(res).toEqual({ blobId: 'mAlStJ4P', jobId: '68000000000000000000abcd' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.tatum.io/v4/data/storage/upload');
    expect(init?.method).toBe('POST');
    const file = (init?.body as FormData).get('file') as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.size).toBe(3);
    expect(log.calls()[0]).toMatchObject({ surface: 'data', method: 'storage/upload', ok: true });
  });

  it('throws a typed error when the upload is refused', async () => {
    const { data } = setup(async () => jsonResponse({ statusCode: 403, message: 'mainnet keys only' }, 403));
    const err = await rejection(data.uploadToWalrus(new Uint8Array([1]), 'image/png'));
    expect(err).toBeInstanceOf(TatumDataError);
    expect(err).toMatchObject({ status: 403 });
  });
});
