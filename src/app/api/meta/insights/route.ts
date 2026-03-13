import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getAccountInsights } from '@/lib/meta-api';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const datePreset = request.nextUrl.searchParams.get('date_preset') || 'today';
  const timeIncrement = request.nextUrl.searchParams.get('time_increment') || undefined;

  try {
    const data = await getAccountInsights(
      session.ad_account_id,
      session.meta_access_token,
      datePreset,
      timeIncrement
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error('Insights fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 });
  }
}
