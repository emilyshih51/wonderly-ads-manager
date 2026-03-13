import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { duplicateCampaign, duplicateAdSet } from '@/lib/meta-api';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { type, id, newName, targetCampaignId } = body;

    let result;

    if (type === 'campaign') {
      result = await duplicateCampaign(id, session.ad_account_id, session.meta_access_token, newName);
    } else if (type === 'adset') {
      result = await duplicateAdSet(id, session.ad_account_id, session.meta_access_token, newName, targetCampaignId);
    } else {
      return NextResponse.json({ error: 'Invalid type. Must be "campaign" or "adset".' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Duplicate error:', error);
    return NextResponse.json({ error: 'Failed to duplicate' }, { status: 500 });
  }
}
