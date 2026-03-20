import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/api/auth', '/api/slack', '/api/automations/evaluate'];

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Sliding window per IP. Not distributed — each Vercel instance tracks its own
// counters, so true RPS seen by any one instance will be a fraction of total.
// This guards against single-source burst abuse; for distributed enforcement
// use Upstash Redis rate limiting middleware.

/** Max requests per IP per window. */
const RATE_LIMIT_MAX = 60;
/** Window size in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Check whether the given IP has exceeded the rate limit.
 * Uses a fixed sliding window: resets the counter once the window expires.
 *
 * @returns `true` if the request should be blocked.
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });

    return false;
  }

  entry.count++;

  return entry.count > RATE_LIMIT_MAX;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Allow static files and API routes that handle their own auth
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname === '/') {
    return NextResponse.next();
  }

  // Rate limit API routes
  if (pathname.startsWith('/api/')) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
  }

  // Check for session cookie
  const session = request.cookies.get('wonderly_session');

  if (!session) {
    const loginUrl = new URL('/login', request.url);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
