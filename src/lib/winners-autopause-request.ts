/**
 * Shared helper for the Auto-pause API routes: which campaign a request is about.
 * `?campaign=<id>` must be one of the campaigns on the page; no param means Winners.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { loadCampaigns, type AutopauseCampaign } from './winners-autopause-runner';
import { WINNERS_CAMPAIGN_ID } from './winners-autopause';

export async function campaignFromRequest(
  request: NextRequest
): Promise<AutopauseCampaign | NextResponse> {
  const id = request.nextUrl.searchParams.get('campaign') || WINNERS_CAMPAIGN_ID;
  const campaign = (await loadCampaigns()).find((c) => c.id === id);

  if (!campaign) {
    return NextResponse.json(
      { error: 'That campaign is not set up for auto-pause' },
      { status: 404 }
    );
  }

  return campaign;
}
