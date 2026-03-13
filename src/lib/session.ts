import { cookies } from 'next/headers';
import { UserSession } from '@/types';

const SESSION_COOKIE = 'wonderly_session';

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

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
