import { QuitsError } from '@quits/service';
import { json } from './json.ts';
import { readSession, type Session } from './session.ts';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const STATUS: Record<QuitsError['code'], number> = { not_found: 404, forbidden: 403, invalid: 400, conflict: 409 };

/** Wraps a route handler: JSON out, typed errors to status codes, never leaks internals. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<unknown>) {
  return async (...a: A): Promise<Response> => {
    try {
      const out = await fn(...a);
      return out instanceof Response ? out : json(out);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      if (e instanceof QuitsError) return json({ error: e.message, code: e.code }, { status: STATUS[e.code] });
      console.error(e);
      return json({ error: 'Something went wrong on our side.' }, { status: 500 });
    }
  };
}

export async function requireSession(): Promise<Session> {
  const s = await readSession();
  if (!s) throw new HttpError(401, 'Sign in first.');
  return s;
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Expected a JSON body.');
  }
}

export function text(v: unknown, field: string, max = 500): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required.`);
  return v.trim().slice(0, max);
}
