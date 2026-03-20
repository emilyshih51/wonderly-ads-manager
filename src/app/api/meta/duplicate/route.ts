import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { type, id, newName, targetCampaignId } = body;

    const meta = new MetaService(session.meta_access_token, session.ad_account_id);
    let result;

    if (type === 'campaign') {
      result = await meta.duplicateCampaign(id, newName);
    } else if (type === 'adset') {
      result = await meta.duplicateAdSet(id, newName, targetCampaignId);
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Must be "campaign" or "adset".' },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Duplicate error:', error);

    return NextResponse.json({ error: 'Failed to duplicate' }, { status: 500 });
  }
}
