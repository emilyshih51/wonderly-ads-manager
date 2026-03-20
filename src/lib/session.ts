import { cookies } from 'next/headers';
import { UserSession } from '@/types';

const SESSION_COOKIE = 'wonderly_session';

/**
 * Read and deserialize the session cookie.
 *
 * @returns The authenticated {@link UserSession}, or `null` if no valid session exists.
 */
export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);

  if (!session) return null;

  try {
    return JSON.parse(session.value) as UserSession;
  } catch {
    return null;
  }
}

/**
 * Serialize and write a session cookie.
 *
 * Cookie is set `httpOnly`, `secure` in production, `sameSite: lax`, and expires in 30 days.
 *
 * @param session - The authenticated user data to persist.
 */
export async function setSession(session: UserSession) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });
}

/**
 * Delete the session cookie, effectively logging the user out.
 */
export async function clearSession() {
  const cookieStore = await cookies();

  cookieStore.delete(SESSION_COOKIE);
}
