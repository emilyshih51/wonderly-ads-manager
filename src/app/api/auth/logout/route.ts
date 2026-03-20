import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();

  cookieStore.delete('wonderly_session');

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`);
}
