import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';

const COOKIE = 'quits_session';
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(s);
};

export interface Session {
  uid: string;
  /** Demo sessions act as a seeded member and pay from capped server wallets. */
  demo?: boolean;
  /** The visitor's own sandbox tab (demo sessions). */
  tab?: string;
}

export async function createSession(s: Session): Promise<void> {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(s.demo ? '2h' : '30d')
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: s.demo ? 7200 : 2_592_000,
  });
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.uid !== 'string') return null;
    return { uid: payload.uid, ...(payload.demo ? { demo: true } : {}), ...(typeof payload.tab === 'string' ? { tab: payload.tab } : {}) };
  } catch {
    return null;
  }
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
