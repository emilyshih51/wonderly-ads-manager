/**
 * Session management.
 *
 * When Redis is available, sessions are stored server-side: only a random
 * session ID is written to the cookie, and the full session data lives in
 * Redis under `session:<id>`. This allows sessions to be revoked server-side
 * (e.g. on logout or token rotation) without waiting for the cookie to expire.
 *
 * When Redis is unavailable (local dev without REDIS_URL), the full session is
 * serialized directly into the cookie — matching the previous behaviour so dev
 * works without any infrastructure.
 *
 * Session TTL: 30 days, refreshed on every write.
 */

import { cookies } from 'next/headers';
import { getRedisClient } from '@/lib/redis';
import { UserSession } from '@/types';
import { createLogger } from '@/services/logger';

const SESSION_COOKIE = 'wonderly_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const REDIS_KEY_PREFIX = 'session:';

const logger = createLogger('Session');

/**
 * Read and deserialize the current session.
 *
 * Reads the session ID from the cookie and looks up the full session in Redis.
 * Falls back to deserializing the cookie value directly when Redis is unavailable.
 *
 * @returns The authenticated {@link UserSession}, or `null` if no valid session exists.
 */
export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE);

  if (!cookie) return null;

  const redis = await getRedisClient();

  if (redis) {
    try {
      const raw = await redis.get(`${REDIS_KEY_PREFIX}${cookie.value}`);

      if (!raw) return null;

      return JSON.parse(raw) as UserSession;
    } catch (err) {
      logger.error('Failed to read session from Redis', err);

      return null;
    }
  }

  // Cookie-only fallback (dev without Redis)
  try {
    return JSON.parse(cookie.value) as UserSession;
  } catch {
    return null;
  }
}

/**
 * Persist a session.
 *
 * When Redis is available, writes the full session to Redis and stores only
 * the session ID in the cookie. Falls back to writing the full session into
 * the cookie when Redis is unavailable.
 *
 * Cookie is set `httpOnly`, `secure` in production, `sameSite: lax`, and
 * expires in 30 days.
 *
 * @param session - The authenticated user data to persist.
 */
export async function setSession(session: UserSession): Promise<void> {
  const cookieStore = await cookies();
  const redis = await getRedisClient();

  if (redis) {
    try {
      const sessionId = crypto.randomUUID();

      await redis.set(`${REDIS_KEY_PREFIX}${sessionId}`, JSON.stringify(session), {
        EX: SESSION_TTL_SECONDS,
      });

      cookieStore.set(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
      });

      return;
    } catch (err) {
      logger.error('Failed to write session to Redis — falling back to cookie', err);
    }
  }

  // Cookie-only fallback (dev without Redis)
  cookieStore.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  });
}

/**
 * Invalidate the current session.
 *
 * Deletes the session record from Redis (if present) and clears the cookie,
 * preventing any further use of the session token.
 */
export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE);

  if (cookie) {
    const redis = await getRedisClient();

    if (redis) {
      try {
        const isSessionId = /^[0-9a-f-]{36}$/.test(cookie.value);

        if (isSessionId) {
          await redis.del(`${REDIS_KEY_PREFIX}${cookie.value}`);
        }
      } catch (err) {
        logger.error('Failed to delete session from Redis', err);
      }
    }
  }

  cookieStore.delete(SESSION_COOKIE);
}
