import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getRedisClient } from '@/lib/redis';
import { evaluateCondition, getResultCount } from '@/lib/automation-utils';
import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';
import { RulesStoreService } from '@/services/rules-store';
import { createLogger } from '@/services/logger';
import type { StoredRule } from '@/services/rules-store';

const logger = createLogger('Automations:Evaluate');

export const maxDuration = 60;

/**
 * GET /api/automations/evaluate
 *
 * Cron endpoint — evaluates all active automation rules against live Meta
 * data and executes the configured actions (pause, activate, promote).
 * Runs every 5 minutes via Vercel cron.
 *
 * When `CRON_SECRET` is set the request must include
 * `Authorization: Bearer <secret>`. In production without `CRON_SECRET` the
 * endpoint is disabled to prevent unauthorized access.
 *
 * Capped at `AUTOMATION_MAX_ACTIONS_PER_RUN` (default 20) actions per run.
 */
export async function GET(request: NextRequest) {
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

  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const defaultAdAccountId =
    session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  const redisClient = await getRedisClient();
  const store = new RulesStoreService(redisClient);
  const activeRules = await store.getActive();

  if (activeRules.length === 0) {
    return NextResponse.json({ evaluated: 0, results: [] });
  }

  const rulesByAccount: Record<string, StoredRule[]> = {};

  for (const rule of activeRules) {
    const accountId = rule.ad_account_id || defaultAdAccountId;

    if (!accountId) continue;
    if (!rulesByAccount[accountId]) rulesByAccount[accountId] = [];
    rulesByAccount[accountId].push(rule);
  }

  const results: unknown[] = [];
  const actionCap = {
    executed: 0,
    max: parseInt(process.env.AUTOMATION_MAX_ACTIONS_PER_RUN || '20'),
  };

  for (const [adAccountId, accountRules] of Object.entries(rulesByAccount)) {
    const meta = new MetaService(accessToken, adAccountId);
    let optimizationMap: Record<string, string> = {};

    try {
      optimizationMap = await meta.getCampaignOptimizationMap();
    } catch (e) {
      logger.error(`Failed to get optimization map for account ${adAccountId}`, e);
    }

    for (const rule of accountRules) {
      try {
        const result = await evaluateRule(
          rule,
          meta,
          adAccountId,
          optimizationMap,
          false,
          false,
          actionCap
        );

        results.push(...result);
      } catch (error) {
        logger.error(`Rule "${rule.name}" (account ${adAccountId}) error`, error);
        results.push({ rule: rule.name, account: adAccountId, error: String(error) });
      }
    }
  }

  return NextResponse.json({
    evaluated: activeRules.length,
    accounts: Object.keys(rulesByAccount).length,
    results,
  });
}

/**
 * POST /api/automations/evaluate
 *
 * Manual test endpoint for a single rule. Body: `{ rule, send_slack?, live? }`.
 * When `live` is false (default), runs in dry-run mode and reports what would happen.
 *
 * @param request - Request body: `{ rule: StoredRule, send_slack?: boolean, live?: boolean }`
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const rawAdAccountId =
    session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken || !rawAdAccountId) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  const body = (await request.json()) as {
    rule?: StoredRule;
    send_slack?: boolean;
    live?: boolean;
  };
  const rule = body.rule;
  const sendSlack = body.send_slack === true;
  const live = body.live === true;

  if (!rule) {
    return NextResponse.json({ error: 'Rule required' }, { status: 400 });
  }

  const meta = new MetaService(accessToken, rawAdAccountId);
  let optimizationMap: Record<string, string> = {};

  try {
    optimizationMap = await meta.getCampaignOptimizationMap();
  } catch (e) {
    logger.error('Failed to get optimization map', e);
  }

  try {
    const dryRun = !live;
    const results = await evaluateRule(
      rule,
      meta,
      rawAdAccountId,
      optimizationMap,
      dryRun,
      sendSlack || live
    );

    return NextResponse.json({
      test: !live,
      dry_run: dryRun,
      live,
      send_slack: sendSlack || live,
      rule_name: rule.name,
      matched: results.length,
      results,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

interface NodeConfig {
  entity_type?: string;
  date_preset?: string;
  campaign_id?: string;
  action_type?: string;
  target_adset_id?: string;
  slack_channel?: string;
  also_notify_slack?: string | boolean;
  slack_message?: string;
}

interface FlowNode {
  type: string;
  data?: { config?: NodeConfig };
}

async function evaluateRule(
  rule: StoredRule,
  meta: MetaService,
  adAccountId: string,
  optimizationMap: Record<string, string>,
  dryRun = false,
  sendSlack = false,
  actionCap?: { executed: number; max: number }
): Promise<unknown[]> {
  const nodes = rule.nodes as FlowNode[];
  const triggerNode = nodes.find((n) => n.type === 'trigger');
  const conditionNodes = nodes.filter((n) => n.type === 'condition');
  const actionNode = nodes.find((n) => n.type === 'action');

  if (!triggerNode || !actionNode) return [];

  const triggerConfig = triggerNode.data?.config ?? {};
  const actionConfig = actionNode.data?.config ?? {};
  const entityType = triggerConfig.entity_type ?? 'ad';
  const datePreset = triggerConfig.date_preset ?? 'last_7d';
  const campaignId = triggerConfig.campaign_id;

  const insightsData = await meta.getFilteredInsights(entityType as 'ad' | 'adset' | 'campaign', {
    datePreset,
    campaignId,
  });

  if (insightsData.length === 0 && !dryRun) {
    logger.warn(
      `No data returned for account ${adAccountId} (rule: "${rule.name}") — skipping to avoid false pauses`
    );

    return [{ rule: rule.name, skipped: 'no_data_returned', account: adAccountId }];
  }

  const results: unknown[] = [];

  // For "today" preset, Meta's reporting pipeline can lag 1–3 hours.
  // A row with zero impressions has no delivery data yet — skip it to
  // prevent false pauses on ads that simply haven't reported yet.
  const isToday = datePreset === 'today';

  for (const row of insightsData) {
    const entityId = (row.ad_id ?? row.adset_id ?? row.campaign_id) as string;
    const entityName = (row.ad_name ?? row.adset_name ?? row.campaign_name ?? entityId) as string;
    const impressions = parseInt(row.impressions ?? '0');

    if (isToday && impressions === 0 && !dryRun) {
      logger.info(
        `Skipping "${entityName}" (${entityId}) — zero impressions on today preset (data may not have propagated yet)`
      );
      results.push({
        rule: rule.name,
        entity_id: entityId,
        entity_name: entityName,
        skipped: 'stale_data_today',
      });
      continue;
    }

    const spend = parseFloat(row.spend ?? '0');
    const rowCampaignId = row.campaign_id;
    const resultCount = getResultCount(row, rowCampaignId, optimizationMap);
    const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

    const metrics = {
      spend,
      impressions,
      clicks: parseInt(row.clicks ?? '0'),
      ctr: parseFloat(row.ctr ?? '0'),
      cpc: parseFloat(row.cpc ?? '0'),
      cpm: parseFloat(row.cpm ?? '0'),
      frequency: parseFloat(row.frequency ?? '0'),
      results: resultCount,
      cost_per_result: costPerResult === Infinity ? 99999 : costPerResult,
    };

    let allConditionsMet = true;

    for (const condNode of conditionNodes) {
      const config = (condNode as FlowNode).data?.config ?? {};
      const metric = (config as Record<string, string>).metric ?? 'spend';
      const operator = (config as Record<string, string>).operator ?? '>';
      const threshold = parseFloat((config as Record<string, string>).threshold ?? '0');
      const actual = (metrics as Record<string, number>)[metric] ?? 0;

      if (metric === 'cost_per_result' && resultCount === 0) {
        allConditionsMet = false;
        break;
      }

      if (!evaluateCondition(actual, operator, threshold)) {
        allConditionsMet = false;
        break;
      }
    }

    if (!allConditionsMet) continue;

    const actionType = actionConfig.action_type ?? '';
    const actionResult: Record<string, unknown> = {
      rule: rule.name,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      metrics: {
        spend,
        results: resultCount,
        cost_per_result: costPerResult === Infinity ? 'N/A' : costPerResult.toFixed(2),
      },
    };

    try {
      if (!dryRun && actionCap && actionCap.executed >= actionCap.max) {
        actionResult.action = 'skipped';
        actionResult.skipped = 'action_cap_reached';
        results.push(actionResult);
        continue;
      }

      if (dryRun) {
        actionResult.action = `would_${actionType}`;
        actionResult.dry_run = true;

        if (actionType === 'promote' && !actionConfig.target_adset_id) {
          actionResult.warning = 'No target ad set ID configured for promotion';
        }
      } else if (actionType === 'pause') {
        await meta.updateStatus(entityId, 'PAUSED');
        actionResult.action = 'paused';
        if (actionCap) actionCap.executed++;
      } else if (actionType === 'activate') {
        await meta.updateStatus(entityId, 'ACTIVE');
        actionResult.action = 'activated';
        if (actionCap) actionCap.executed++;
      } else if (actionType === 'promote') {
        await meta.updateStatus(entityId, 'PAUSED');
        const targetAdSetId = actionConfig.target_adset_id;

        if (targetAdSetId) {
          const duplicated = await meta.duplicateAd(entityId, targetAdSetId);

          actionResult.action = 'promoted';
          actionResult.duplicated_ad_id = duplicated.id;
        } else {
          actionResult.action = 'paused (no target adset for duplication)';
        }

        if (actionCap) actionCap.executed++;
      }

      if (
        actionConfig.slack_channel &&
        (actionConfig.also_notify_slack === 'true' || actionConfig.also_notify_slack === true)
      ) {
        if (!dryRun || sendSlack) {
          const slack = new SlackService(
            process.env.SLACK_BOT_TOKEN ?? '',
            process.env.SLACK_SIGNING_SECRET ?? ''
          );

          await slack
            .sendAutomationNotification(actionConfig.slack_channel, {
              ruleName: rule.name,
              actionType: actionType as 'pause' | 'activate' | 'promote',
              entityType,
              entityId,
              entityName,
              adAccountId,
              metrics: {
                spend: metrics.spend,
                results: metrics.results,
                cost_per_result: metrics.cost_per_result,
                clicks: metrics.clicks,
                ctr: metrics.ctr,
              },
              duplicatedAdId: actionResult.duplicated_ad_id as string | undefined,
              customMessage: actionConfig.slack_message,
              prefix: dryRun ? '🧪 *[TEST]* ' : '',
            })
            .catch((e: unknown) => logger.error('Slack notification failed', e));

          actionResult.slack_sent = true;
        }

        actionResult.slack_channel = actionConfig.slack_channel;
      }
    } catch (actionError) {
      actionResult.error = String(actionError);
    }

    results.push(actionResult);
  }

  return results;
}
