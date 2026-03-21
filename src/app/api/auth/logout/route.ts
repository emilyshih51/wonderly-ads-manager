import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';
import { createLogger } from '@/services/logger';

const logger = createLogger('Auth:Logout');

/**
 * POST /api/auth/logout
 *
 * Clears the session and redirects to /login.
 */
export async function POST() {
  logger.info('Logging out');
  await clearSession();

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`, 303);
}
