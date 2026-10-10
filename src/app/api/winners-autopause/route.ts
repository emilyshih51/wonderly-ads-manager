/**
 * /api/winners-autopause?campaign=<id> — backs the Auto-pause page. No `campaign` = Winners.
 *
 *   GET  → campaigns on the page, plus this campaign's settings, recent runs, change history,
 *          and any active Automations rules that also pause ads in it
 *   PUT  → update this campaign's settings (mode, numbers, rule on/off)
 *   POST → "Run check now" for this campaign: refreshes the table. Never pauses.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getRedisClient } from '@/lib/redis';
import { requireSession } from '@/lib/session';
import type { AutopauseSettings } from '@/lib/winners-autopause';
import { campaignFromRequest } from '@/lib/winners-autopause-request';
import {
  AutopauseRateLimitError,
  envKillSwitch,
  loadCampaigns,
  loadChanges,
  loadRuns,
  loadSettings,
  runAutopause,
  saveSettings,
} from '@/lib/winners-autopause-runner';
import { createLogger } from '@/services/logger';
import { RulesStoreService } from '@/services/rules-store';

const logger = createLogger('WinnersAutopauseApi');

export const maxDuration = 120;

/** Active Automations rules that can pause ads and point at this campaign. */
async function overlappingRules(campaignId: string): Promise<string[]> {
  try {
    const rules = await new RulesStoreService(await getRedisClient()).getActive();

    return rules
      .filter((r) => {
        const json = JSON.stringify(r.nodes);

        return json.includes(campaignId) && json.includes('"pause"');
      })
      .map((r) => r.name);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  const campaign = await campaignFromRequest(request);

  if (campaign instanceof NextResponse) return campaign;

  const [campaigns, { settings, persisted }, allRuns, changes, overlaps] = await Promise.all([
    loadCampaigns(),
    loadSettings(campaign.id),
    loadRuns(campaign.id, 10),
    loadChanges(campaign.id, 10),
    overlappingRules(campaign.id),
  ]);
  const modes = Object.fromEntries(
    await Promise.all(
      campaigns.map(async (c) => {
        const { settings: s } = await loadSettings(c.id);

        return [c.id, !s.enabled ? 'off' : s.dryRun ? 'dry' : 'live'] as const;
      })
    )
  );
  // Only the latest run needs its per-day data (for "what if" previews) — keep the payload small.
  const runs = allRuns.map((run, i) => (i === 0 ? run : { ...run, inputs: undefined }));

  return NextResponse.json({
    campaigns,
    modes,
    campaign,
    settings,
    persisted,
    envKillSwitch: envKillSwitch(),
    runs,
    changes,
    overlaps,
  });
}

export async function PUT(request: NextRequest) {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  const campaign = await campaignFromRequest(request);

  if (campaign instanceof NextResponse) return campaign;

  try {
    const patch = (await request.json()) as Partial<AutopauseSettings>;
    const settings = await saveSettings(
      campaign.id,
      patch,
      session.name || session.email || session.id
    );

    logger.info('Settings updated', { by: session.id, campaign: campaign.id, settings });

    return NextResponse.json({ settings });
  } catch (error) {
    logger.error('Failed to save settings', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession();

  if (session instanceof NextResponse) return session;

  const campaign = await campaignFromRequest(request);

  if (campaign instanceof NextResponse) return campaign;

  try {
    const run = await runAutopause('preview', campaign);

    return NextResponse.json({ run });
  } catch (error) {
    logger.error('Preview run failed', error);

    if (error instanceof AutopauseRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Run failed' },
      { status: 500 }
    );
  }
}
