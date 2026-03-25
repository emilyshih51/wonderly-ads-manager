import { NextRequest, NextResponse } from 'next/server';
import { createSlackService } from '@/services/slack';
import { DigestService } from '@/services/digest';
import { createLogger } from '@/services/logger';
import type { DigestType } from '@/services/digest';

const logger = createLogger('Slack:Digest');

const DIGEST_TYPES = new Set<DigestType>(['daily', 'weekly', 'monthly']);

/**
 * GET /api/slack/digest
 *
 * Cron endpoint — posts a periodic ad performance digest to the configured
 * Slack channel. Accepts a `?type=` query param (`daily` | `weekly` | `monthly`,
 * defaults to `weekly`).
 *
 * Auth: same `Authorization: Bearer <CRON_SECRET>` pattern as the automation
 * evaluator. In production without `CRON_SECRET` the endpoint returns 503.
 *
 * Required env vars:
 * - `SLACK_DIGEST_CHANNEL_IDS` — comma-separated Slack channel IDs to post the digest to
 * - `META_SYSTEM_ACCESS_TOKEN` — system token for Meta API reads
 * - `META_AD_ACCOUNT_ID` or `META_AD_ACCOUNT_IDS` — accounts to summarise
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  if (cronSecret) {
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    logger.warn('CRON_SECRET is not set in production. Refusing request.');

    return NextResponse.json(
      { error: 'CRON_SECRET not configured — endpoint disabled' },
      { status: 503 }
    );
  } else {
    logger.warn('CRON_SECRET not set — digest endpoint is unprotected (dev only)');
  }

  // Digest is always sent to #emily-space only, regardless of SLACK_DIGEST_CHANNEL_IDS
  const DIGEST_CHANNEL = 'C0951M3JF7H';
  const channelIds = [DIGEST_CHANNEL];

  const configuredChannels = (process.env.SLACK_DIGEST_CHANNEL_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (configuredChannels.length > 0) {
    logger.info('SLACK_DIGEST_CHANNEL_IDS is set but digest is locked to #emily-space', {
      configured: configuredChannels,
      actual: channelIds,
    });
  }

  const allowedChannels = (process.env.ALLOWED_SLACK_CHANNEL_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedChannels.length > 0) {
    const blocked = channelIds.filter((id) => !allowedChannels.includes(id));

    if (blocked.length > 0) {
      logger.warn('Some digest channels are not in ALLOWED_SLACK_CHANNEL_IDS', { blocked });

      return NextResponse.json(
        { error: 'One or more digest channels not in allowlist' },
        { status: 403 }
      );
    }
  }

  const metaSystemToken = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!metaSystemToken) {
    return NextResponse.json({ error: 'META_SYSTEM_ACCESS_TOKEN not set' }, { status: 503 });
  }

  const accountIdsRaw = process.env.META_AD_ACCOUNT_IDS ?? process.env.META_AD_ACCOUNT_ID ?? '';
  const accountIds = accountIdsRaw
    .split(',')
    .map((id) => id.trim().replace(/^act_/, ''))
    .filter(Boolean);

  if (accountIds.length === 0) {
    return NextResponse.json(
      { error: 'No ad account IDs configured (META_AD_ACCOUNT_ID / META_AD_ACCOUNT_IDS)' },
      { status: 503 }
    );
  }

  const typeParam = request.nextUrl.searchParams.get('type') ?? 'weekly';
  const digestType: DigestType = DIGEST_TYPES.has(typeParam as DigestType)
    ? (typeParam as DigestType)
    : 'weekly';

  const slack = createSlackService();
  const digest = new DigestService(slack);

  const result = await digest.send({
    type: digestType,
    channelIds,
    accountIds,
    metaSystemToken,
  });

  const failed = result.channels.filter((c) => c.error);

  return NextResponse.json(
    {
      ok: failed.length === 0,
      type: digestType,
      channels: result.channels,
      ...(failed.length > 0 && {
        errors: failed.map((c) => ({ channelId: c.channelId, error: c.error })),
      }),
    },
    { status: failed.length > 0 && failed.length === result.channels.length ? 500 : 200 }
  );
}
