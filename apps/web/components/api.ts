export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Sign in first.',
  403: 'You can’t do that here.',
  404: 'Not found.',
  409: 'That changed in the meantime. Reload and try again.',
  500: 'Something went wrong on our side. Try again.',
};

interface Opts {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
}

async function raw<T>(path: string, method: 'GET' | 'POST', body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T };
}

/**
 * Identical GETs in flight share one request. Group reads also bring debts up
 * to date on the server, so two at once (a re-mounted effect, a poll racing a
 * click) must not reach it together.
 */
const inflight = new Map<string, Promise<{ status: number; data: unknown }>>();

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Raw call: status + parsed JSON, never throws on HTTP status. */
export async function call<T = unknown>(path: string, o: Opts = {}): Promise<{ status: number; data: T }> {
  const method = o.method ?? (o.body !== undefined ? 'POST' : 'GET');
  if (method === 'POST') return raw<T>(path, method, o.body);
  let p = inflight.get(path);
  if (!p) {
    p = raw<unknown>(path, 'GET', undefined).finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  const shared = p as Promise<{ status: number; data: T }>;
  return o.signal ? abortable(shared, o.signal) : shared;
}

/** JSON call that throws ApiError with the server's own message on 4xx/5xx. */
export async function api<T = unknown>(path: string, o: Opts = {}): Promise<T> {
  let r: { status: number; data: T };
  try {
    r = await call<T>(path, o);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Can’t reach Quits. Check your connection and try again.');
  }
  if (r.status >= 400) {
    const msg = (r.data as { error?: unknown } | null)?.error;
    throw new ApiError(r.status, typeof msg === 'string' && msg ? msg : (FALLBACK[r.status] ?? `Request failed (${r.status}).`), r.data);
  }
  return r.data;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get<T>(key: string): T | null {
    try {
      const v = window.localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};
