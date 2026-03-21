import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { metaErrorResponse } from '@/lib/meta-error-response';
import { createLogger } from '@/services/logger';

const logger = createLogger('Meta:Duplicate');

/**
 * POST /api/meta/duplicate
 *
 * Duplicates a campaign or ad set via the Meta API.
 * Required body fields: `type` (`"campaign"` | `"adset"`), `id`.
 * Optional: `newName`, `targetCampaignId` (for ad set duplication).
 */
export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  try {
    const body = await request.json();
    const { type, id, newName, targetCampaignId } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const meta = MetaService.fromSession(session);
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
    logger.error('Duplicate error', error);

    return metaErrorResponse(error, 'Failed to duplicate');
  }
}
