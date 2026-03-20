import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * GET /api/auth/logout
 *
 * Clears the wonderly_session cookie and redirects to /login.
 */
export async function GET() {
  const cookieStore = await cookies();

  cookieStore.delete('wonderly_session');

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`);
}
