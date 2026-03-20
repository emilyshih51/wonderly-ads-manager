import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';

/**
 * POST /api/auth/logout
 *
 * Clears the session and redirects to /login.
 */
export async function POST() {
  await clearSession();

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`);
}
