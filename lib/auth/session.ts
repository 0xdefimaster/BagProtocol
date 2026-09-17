import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// -----------------------------------------------------------------------------
// Wallet-login session. A successful signature verification (see
// app/api/auth/verify/route.ts) issues one of these as an httpOnly cookie —
// this is the "Session" step in Wallet -> Sign -> Nonce -> Session -> User.
//
// This intentionally does NOT use Supabase Auth: there's no email/password
// or OAuth identity here, only a wallet signature, and Supabase Auth has no
// first-class "bring your own signature scheme" flow. A short JWT naming the
// already-created `users.id` row is simpler and is exactly what RLS policies
// keyed on auth.uid() would need if this later moves to Supabase Auth's
// custom-JWT support — the payload shape (a stable userId) doesn't change.
// -----------------------------------------------------------------------------

const COOKIE_NAME = 'bag_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string;
  walletAddress: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET is not set (or too short). Set a long random string — see .env.example.'
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, walletAddress: payload.walletAddress })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.userId !== 'string' || typeof payload.walletAddress !== 'string') {
      return null;
    }
    return { userId: payload.userId, walletAddress: payload.walletAddress };
  } catch {
    return null; // expired, tampered, or wrong secret — treat all the same: not signed in
  }
}

/** Call only from a Route Handler or Server Action — `cookies().set()` throws in a Server Component render. */
export function setSessionCookie(token: string): void {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(): void {
  cookies().set(COOKIE_NAME, '', { path: '/', maxAge: 0 });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
