import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { MetaService } from '@/services/meta';
import { createSlackService } from '@/services/slack';
import { createLogger } from '@/services/logger';
import type { MetaCampaign, MetaAdSet } from '@/types';

const logger = createLogger('Automations:BudgetMonitor');
const REDIS_KEY_PREFIX = 'budget_snapshot:';

export const maxDuration = 60;

interface BudgetSnapshot {
  [entityId: string]: number; // budget in cents
}

interface BudgetChange {
  entityId: string;
  entityName: string;
  entityType: 'campaign' | 'adset';
  previousBudget: number;
  newBudget: number;
}

interface MonitorResult {
  account: string;
  campaignsChecked: number;
  adSetsChecked: number;
  changes: BudgetChange[];
  error?: string;
}

/**
 * GET /api/automations/budget-monitor
 *
 * Cron endpoint — polls Meta for budget changes on campaigns and ad sets,
 * compares against a Redis snapshot from the last poll, and sends Slack
 * notifications for any changes detected.
 *
 * Runs every 5 minutes via Vercel cron. Requires `CRON_SECRET` in production.
 * Sends notifications to `SLACK_BUDGET_MONITOR_CHANNEL` with fallback to
 * `SLACK_NOTIFICATION_CHANNEL`.
 *
 * On first run for an account (no snapshot exists), saves the snapshot
 * without sending notifications.
 */
export async function GET(request: NextRequest) {
  const start = Date.now();
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');

  if (cronSecret) {
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'CRON_SECRET is not set in production. Refusing request to prevent unauthorized access.'
    );

    return NextResponse.json(
      { error: 'CRON_SECRET not configured — endpoint disabled' },
      { status: 503 }
    );
  } else {
    logger.warn('CRON_SECRET not set — cron endpoint is unprotected (dev only)');
  }

  const accessToken = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  // Support both single account and multi-account modes
  const defaultAdAccountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  const multiAccountIds = (process.env.META_AD_ACCOUNT_IDS || '')
    .split(',')
    .map((id) => id.replace(/^act_/, '').trim())
    .filter(Boolean);

  const accountIds =
    multiAccountIds.length > 0 ? multiAccountIds : [defaultAdAccountId].filter(Boolean);

  if (accountIds.length === 0) {
    return NextResponse.json({ error: 'No ad accounts configured' }, { status: 400 });
  }

  const redisClient = await getRedisClient();
  const slack = createSlackService();
  const notificationChannel =
    process.env.SLACK_BUDGET_MONITOR_CHANNEL || process.env.SLACK_NOTIFICATION_CHANNEL;

  const results: MonitorResult[] = [];

  for (const adAccountId of accountIds) {
    const monitorResult: MonitorResult = {
      account: adAccountId,
      campaignsChecked: 0,
      adSetsChecked: 0,
      changes: [],
    };

    try {
      const meta = new MetaService(accessToken, adAccountId);

      // Fetch campaigns
      let campaigns: MetaCampaign[] = [];
      let adSets: MetaAdSet[] = [];

      try {
        const campaignsResponse = await meta.getCampaigns();

        campaigns = campaignsResponse.data || [];
      } catch (e) {
        logger.error(`Failed to fetch campaigns for account ${adAccountId}`, e);
      }

      // Fetch ad sets
      try {
        const adSetsResponse = await meta.getAdSets();

        adSets = adSetsResponse.data || [];
      } catch (e) {
        logger.error(`Failed to fetch ad sets for account ${adAccountId}`, e);
      }

      // Load previous snapshot from Redis
      const snapshotKey = `${REDIS_KEY_PREFIX}${adAccountId}`;
      const previousSnapshot: BudgetSnapshot = {};

      if (redisClient) {
        try {
          const snapshotData = await redisClient.hGetAll(snapshotKey);

          if (snapshotData) {
            for (const [key, val] of Object.entries(snapshotData)) {
              previousSnapshot[key] = Number(val);
            }
          }
        } catch (e) {
          logger.warn(`Failed to load budget snapshot for account ${adAccountId}`, e);
        }
      }

      // Build new snapshot and detect changes
      const newSnapshot: BudgetSnapshot = {};

      // Check campaigns
      for (const campaign of campaigns) {
        if (!campaign.daily_budget) continue;

        const budgetCents = parseInt(campaign.daily_budget, 10);

        if (Number.isNaN(budgetCents)) continue;

        newSnapshot[campaign.id] = budgetCents;
        monitorResult.campaignsChecked++;

        const previousBudgetCents = previousSnapshot[campaign.id];

        // Detect budget changes
        if (previousBudgetCents !== undefined && previousBudgetCents !== budgetCents) {
          monitorResult.changes.push({
            entityId: campaign.id,
            entityName: campaign.name,
            entityType: 'campaign',
            previousBudget: previousBudgetCents,
            newBudget: budgetCents,
          });
        }
      }

      // Check ad sets
      for (const adSet of adSets) {
        if (!adSet.daily_budget) continue;

        const budgetCents = parseInt(adSet.daily_budget, 10);

        if (Number.isNaN(budgetCents)) continue;

        newSnapshot[adSet.id] = budgetCents;
        monitorResult.adSetsChecked++;

        const previousBudgetCents = previousSnapshot[adSet.id];

        // Detect budget changes
        if (previousBudgetCents !== undefined && previousBudgetCents !== budgetCents) {
          monitorResult.changes.push({
            entityId: adSet.id,
            entityName: adSet.name,
            entityType: 'adset',
            previousBudget: previousBudgetCents,
            newBudget: budgetCents,
          });
        }
      }

      // Save new snapshot to Redis
      if (redisClient && Object.keys(newSnapshot).length > 0) {
        try {
          for (const [field, value] of Object.entries(newSnapshot)) {
            await redisClient.hSet(snapshotKey, field, value);
          }
        } catch (e) {
          logger.error(`Failed to save budget snapshot for account ${adAccountId}`, e);
        }
      }

      // Send Slack notifications for detected changes (skip first run when no previous snapshot exists)
      const isFirstRun = Object.keys(previousSnapshot).length === 0;

      if (!isFirstRun && monitorResult.changes.length > 0 && notificationChannel) {
        for (const change of monitorResult.changes) {
          try {
            await slack
              .sendBudgetNotification(notificationChannel, {
                entityName: change.entityName,
                newBudget: change.newBudget / 100,
                previousBudget: change.previousBudget / 100,
              })
              .catch((e: unknown) => {
                logger.error(`Failed to send Slack notification for ${change.entityName}`, e);
              });
          } catch (e) {
            logger.error(`Slack notification error for ${change.entityName}`, e);
          }
        }
      }

      if (isFirstRun && Object.keys(newSnapshot).length > 0) {
        logger.info(
          `Budget monitor: First run for account ${adAccountId} — snapshot saved, no notifications sent`,
          {
            campaignsChecked: monitorResult.campaignsChecked,
            adSetsChecked: monitorResult.adSetsChecked,
          }
        );
      }

      results.push(monitorResult);
    } catch (error) {
      logger.error(`Budget monitor error for account ${adAccountId}`, error);
      monitorResult.error = String(error);
      results.push(monitorResult);
    }
  }

  logger.info('Budget monitor complete', {
    accounts: accountIds.length,
    totalChanges: results.reduce((sum, r) => sum + r.changes.length, 0),
    durationMs: Date.now() - start,
  });

  return NextResponse.json({
    accounts: accountIds.length,
    results,
  });
}
