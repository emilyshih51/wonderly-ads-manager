import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getRedisClient } from '@/lib/redis';
import {
  evaluateCondition,
  parseInsightMetrics,
  calculateNewBudget,
  COST_PER_RESULT_NO_DATA,
} from '@/lib/automation-utils';
import { MetaService } from '@/services/meta';
import { createSlackService } from '@/services/slack';
import { RulesStoreService } from '@/services/rules-store';
import { createLogger } from '@/services/logger';
import type { StoredRule } from '@/services/rules-store';
import type { MetaInsightsRow } from '@/types';

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

  // Cron endpoint uses only the system token — never fall back to user session tokens
  const accessToken = process.env.META_SYSTEM_ACCESS_TOKEN;
  const defaultAdAccountId = (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

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

  const results: EvaluateResult[] = [];
  const actionCap = {
    executed: 0,
    max: parseInt(process.env.AUTOMATION_MAX_ACTIONS_PER_RUN || '20', 10) || 20,
  };

  for (const [adAccountId, accountRules] of Object.entries(rulesByAccount)) {
    const meta = new MetaService(accessToken, adAccountId);
    let optimizationMap: Record<string, string> = {};

    try {
      optimizationMap = await meta.getCampaignOptimizationMap();
    } catch (e) {
      logger.error(`Failed to get optimization map for account ${adAccountId}`, e);
    }

    const now = new Date();

    for (const rule of accountRules) {
      const triggerNode = rule.nodes.find((n) => n.type === 'trigger');
      const schedule = (triggerNode?.data?.config as { schedule?: string } | undefined)?.schedule;

      if (!shouldRunRule(schedule, now)) {
        logger.info('Skipping rule (not due this tick)', { rule: rule.name, schedule });
        continue;
      }

      try {
        const result = await evaluateRule(rule, meta, adAccountId, optimizationMap, {
          actionCap,
        });

        results.push(...result);
      } catch (error) {
        logger.error(`Rule "${rule.name}" (account ${adAccountId}) error`, error);
        results.push({ rule: rule.name, account: adAccountId, error: String(error) });
      }
    }
  }

  // Send grouped budget change summary per channel per direction
  const budgetResults = results.filter(
    (r) => r.action === 'budget_increased' || r.action === 'budget_decreased'
  );

  if (budgetResults.length > 0) {
    const slack = createSlackService();
    const summaryChannel =
      process.env.SLACK_BUDGET_SUMMARY_CHANNEL ||
      budgetResults.find((r) => r.slack_channel)?.slack_channel;

    if (summaryChannel) {
      // Group by channel, then direction
      const byChannel: Record<string, typeof budgetResults> = {};

      for (const r of budgetResults) {
        const ch = r.slack_channel ?? summaryChannel;

        if (!byChannel[ch]) byChannel[ch] = [];
        byChannel[ch].push(r);
      }

      const runTime = new Date();

      for (const [ch, channelResults] of Object.entries(byChannel)) {
        const increases = channelResults.filter((r) => r.action === 'budget_increased');
        const decreases = channelResults.filter((r) => r.action === 'budget_decreased');

        for (const [direction, group] of [
          ['increase', increases],
          ['decrease', decreases],
        ] as const) {
          if (group.length === 0) continue;

          await slack
            .sendBudgetRunSummary(ch, {
              direction,
              changes: group.map((r) => ({
                entityName: r.entity_name ?? r.entity_id ?? '',
                newBudget: r.new_budget ?? 0,
              })),
              runTime,
            })
            .catch((e: unknown) => logger.error('Slack budget run summary failed', e));
        }
      }
    }
  }

  logger.info('Evaluation complete', {
    evaluated: activeRules.length,
    accounts: Object.keys(rulesByAccount).length,
    actions: results.length,
    durationMs: Date.now() - start,
  });

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
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const rawAdAccountId = session.ad_account_id;

  const body = (await request.json()) as {
    rule?: StoredRule;
    send_slack?: boolean;
    live?: boolean;
    test_channel?: string;
    test_data?: {
      entity_name: string;
      spend: number;
      results: number;
      clicks: number;
      ctr: number;
      impressions: number;
    };
  };
  const rule = body.rule;
  const sendSlack = body.send_slack === true;
  const live = body.live === true;
  const testChannel = body.test_channel;
  const testData = body.test_data;

  if (!rule) {
    return NextResponse.json({ error: 'Rule required' }, { status: 400 });
  }

  const meta = MetaService.fromSession(session);
  let optimizationMap: Record<string, string> = {};

  try {
    optimizationMap = await meta.getCampaignOptimizationMap();
  } catch (e) {
    logger.error('Failed to get optimization map', e);
  }

  try {
    const dryRun = !live;
    const results = await evaluateRule(rule, meta, rawAdAccountId, optimizationMap, {
      dryRun,
      sendSlack: sendSlack || live,
      testChannel,
      testData,
    });

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
    logger.error('Manual evaluate error', error);

    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 });
  }
}

interface NodeConfig {
  entity_type?: string;
  date_preset?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_filter?: string;
  adset_name?: string;
  action_type?: string;
  target_adset_id?: string;
  slack_channel?: string;
  also_notify_slack?: string | boolean;
  slack_message?: string;
  metric?: string;
  operator?: string;
  threshold?: string;
  adjust_direction?: 'increase' | 'decrease';
  adjust_amount_type?: 'percent' | 'fixed';
  adjust_amount?: number | string;
}

interface EvaluateResult {
  rule: string;
  entity_type?: string;
  entity_id?: string;
  entity_name?: string;
  metrics?: { spend: number; results: number; cost_per_result: number | string };
  action?: string;
  dry_run?: boolean;
  warning?: string;
  duplicated_ad_id?: string;
  slack_sent?: boolean;
  slack_channel?: string;
  skipped?: string;
  account?: string;
  error?: string;
  previous_budget?: number;
  new_budget?: number;
  skip_reason?: string;
}

interface EvaluateRuleOptions {
  dryRun?: boolean;
  sendSlack?: boolean;
  actionCap?: { executed: number; max: number };
  testChannel?: string;
  testData?: {
    entity_name: string;
    spend: number;
    results: number;
    clicks: number;
    ctr: number;
    impressions: number;
  };
}

/**
 * Returns true if a rule with the given schedule should run on this cron tick.
 * The cron fires every 5 minutes; this gates rules that run less frequently.
 *
 * @param schedule - Schedule value from the trigger config
 * @param now - Current UTC time
 */
function shouldRunRule(schedule: string | undefined, now: Date): boolean {
  const m = now.getUTCMinutes();
  const h = now.getUTCHours();

  switch (schedule) {
    case '5min':
      return true;
    case '15min':
      // Aligned to wall-clock boundaries (0, 15, 30, 45). Cron ticks at :05, :10, etc.
      // will skip — this is intentional, not a bug.
      return m % 15 === 0;
    case 'hourly':
      return m === 0;
    case '6hours':
      // Allow up to 4 min of cron jitter before declaring the window missed.
      return h % 6 === 0 && m < 5;
    case 'daily':
      return h === 0 && m < 5;
    default:
      return true;
  }
}

async function evaluateRule(
  rule: StoredRule,
  meta: MetaService,
  adAccountId: string,
  optimizationMap: Record<string, string>,
  options: EvaluateRuleOptions = {}
): Promise<EvaluateResult[]> {
  const { dryRun = false, sendSlack = false, actionCap, testChannel, testData } = options;
  const nodes = rule.nodes;
  const triggerNode = nodes.find((n) => n.type === 'trigger');
  const conditionNodes = nodes.filter((n) => n.type === 'condition');
  const actionNode = nodes.find((n) => n.type === 'action');

  if (!triggerNode || !actionNode) return [];

  const triggerConfig = (triggerNode.data?.config ?? {}) as NodeConfig;
  const actionConfig = (actionNode.data?.config ?? {}) as NodeConfig;
  const entityType = triggerConfig.entity_type ?? 'ad';
  const datePreset = triggerConfig.date_preset ?? 'last_7d';
  // Support comma-separated campaign IDs for multi-campaign rules
  const campaignIdRaw = triggerConfig.campaign_id ?? '';
  const campaignIds = campaignIdRaw
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  // When testData is provided, use synthetic data instead of querying Meta
  let insightsData: MetaInsightsRow[];

  if (testData) {
    insightsData = [
      {
        ad_id: 'test_ad_001',
        ad_name: testData.entity_name || 'Sample Ad',
        adset_id: 'test_adset_001',
        campaign_id: campaignIds[0] || 'test_campaign_001',
        campaign_name: triggerConfig.campaign_name || 'Sample Campaign',
        spend: String(testData.spend),
        impressions: String(testData.impressions),
        clicks: String(testData.clicks),
        ctr: String(testData.ctr),
        cpc: testData.clicks > 0 ? String(testData.spend / testData.clicks) : '0',
        cpm: '0',
        actions:
          testData.results > 0
            ? [{ action_type: 'offsite_conversion', value: String(testData.results) }]
            : [],
      },
    ];
  } else if (campaignIds.length <= 1) {
    // Single campaign or no filter — use existing single-query path
    insightsData = await meta.getFilteredInsights(entityType as 'ad' | 'adset' | 'campaign', {
      datePreset,
      campaignId: campaignIds[0],
    });
  } else {
    // Multi-campaign: query each campaign and merge results
    const allRows = await Promise.all(
      campaignIds.map((cid) =>
        meta.getFilteredInsights(entityType as 'ad' | 'adset' | 'campaign', {
          datePreset,
          campaignId: cid,
        })
      )
    );

    insightsData = allRows.flat();
  }

  // Filter by ad set if specified
  const adsetFilter = triggerConfig.adset_filter ?? 'all';

  if (adsetFilter && adsetFilter !== 'all' && !testData) {
    insightsData = insightsData.filter((row) => row.adset_id === adsetFilter);
  }

  if (insightsData.length === 0 && !dryRun) {
    logger.warn(
      `No data returned for account ${adAccountId} (rule: "${rule.name}") — skipping to avoid false pauses`
    );

    return [{ rule: rule.name, skipped: 'no_data_returned', account: adAccountId }];
  }

  const results: EvaluateResult[] = [];
  const slack = createSlackService();

  // For "today" preset, Meta's reporting pipeline can lag 1–3 hours.
  // A row with zero impressions has no delivery data yet — skip it to
  // prevent false pauses on ads that simply haven't reported yet.
  const isToday = datePreset === 'today';

  for (const row of insightsData) {
    const entityId = (row.ad_id ?? row.adset_id ?? row.campaign_id) as string;
    const entityName = (row.ad_name ?? row.adset_name ?? row.campaign_name ?? entityId) as string;
    const impressions = parseInt(row.impressions ?? '0', 10);

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

    const metrics = parseInsightMetrics(row, optimizationMap);

    // Debug: log action types when results are 0 but spend > 0 (suggests action type mismatch)
    if (metrics.results === 0 && metrics.spend > 0 && row.actions?.length) {
      const actionTypes = row.actions.map((a) => `${a.action_type}=${a.value}`).join(', ');
      const campaignId = row.campaign_id;
      const mappedType = campaignId ? optimizationMap[campaignId] : undefined;

      logger.warn('Zero results despite spend > 0 — possible action type mismatch', {
        entity: entityName,
        spend: metrics.spend,
        mappedResultType: mappedType || 'none',
        actionTypes,
      });
    }

    let allConditionsMet = true;

    for (const condNode of conditionNodes) {
      const condConfig = (condNode.data?.config ?? {}) as NodeConfig;
      const metric = condConfig.metric ?? 'spend';
      const operator = condConfig.operator ?? '>';
      const threshold = parseFloat(condConfig.threshold ?? '0');
      const actual = metrics[metric as keyof typeof metrics] ?? 0;

      if (metric === 'cost_per_result' && metrics.results === 0) {
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
    const actionResult: EvaluateResult = {
      rule: rule.name,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      metrics: {
        spend: metrics.spend,
        results: metrics.results,
        cost_per_result:
          metrics.cost_per_result === COST_PER_RESULT_NO_DATA
            ? 'N/A'
            : metrics.cost_per_result.toFixed(2),
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
      } else if (actionType === 'adjust_budget') {
        if (entityType === 'ad') {
          actionResult.skipped = 'unsupported_entity';
          actionResult.skip_reason = 'adjust_budget is not supported for ad entities';
        } else {
          const direction = actionConfig.adjust_direction ?? 'increase';
          const amountType = actionConfig.adjust_amount_type ?? 'percent';
          const amount =
            typeof actionConfig.adjust_amount === 'string'
              ? parseFloat(actionConfig.adjust_amount)
              : (actionConfig.adjust_amount ?? 0);

          if (!amount || !Number.isFinite(amount) || amount <= 0) {
            actionResult.skipped = 'invalid_config';
            actionResult.skip_reason = 'adjust_amount must be a positive number';
          } else {
            const currentBudgetCents = await meta.getBudget(entityId);

            if (currentBudgetCents === null) {
              actionResult.skipped = 'lifetime_budget';
              actionResult.skip_reason =
                'Entity uses a lifetime budget — daily budget adjustment not supported';
            } else {
              const newBudgetCents = calculateNewBudget(
                currentBudgetCents,
                direction,
                amountType,
                amount
              );

              if (!dryRun) {
                try {
                  await meta.updateBudget(entityId, newBudgetCents);
                } catch (budgetError) {
                  actionResult.error = String(budgetError);
                  results.push(actionResult);
                  continue;
                }
              }

              actionResult.action =
                direction === 'increase' ? 'budget_increased' : 'budget_decreased';
              actionResult.previous_budget = currentBudgetCents / 100;
              actionResult.new_budget = newBudgetCents / 100;
              if (actionCap) actionCap.executed++;
            }
          }
        }
      }

      const notifySlack =
        actionConfig.also_notify_slack === 'true' || actionConfig.also_notify_slack === true;

      // When a testChannel is provided, always send to the override channel
      const effectiveSlackChannel = testChannel || actionConfig.slack_channel;
      const shouldNotifySlack = testChannel ? true : notifySlack;

      if (effectiveSlackChannel && shouldNotifySlack) {
        if (!dryRun || sendSlack) {
          if (
            actionType === 'adjust_budget' &&
            actionResult.action &&
            actionResult.new_budget !== undefined
          ) {
            await slack
              .sendBudgetNotification(effectiveSlackChannel, {
                entityName,
                newBudget: actionResult.new_budget,
                previousBudget: actionResult.previous_budget,
              })
              .catch((e: unknown) => logger.error('Slack budget notification failed', e));
          } else {
            await slack
              .sendAutomationNotification(effectiveSlackChannel, {
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
                // Use the campaign name from the insight row so multi-campaign rules
                // show only the campaign that actually matched, not all configured campaigns.
                campaignName:
                  (row.campaign_name as string) || (triggerConfig.campaign_name as string) || '',
                datePreset,
                customMessage: actionConfig.slack_message,
                prefix: dryRun ? '🧪 *[TEST]* ' : '',
              })
              .catch((e: unknown) => logger.error('Slack notification failed', e));
          }

          actionResult.slack_sent = true;
        }

        actionResult.slack_channel = effectiveSlackChannel;
      }
    } catch (actionError) {
      actionResult.error = String(actionError);
    }

    results.push(actionResult);
  }

  return results;
}
