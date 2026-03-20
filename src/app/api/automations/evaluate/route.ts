import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';
import { RulesStoreService } from '@/services/rules-store';
import { createClient, type RedisClientType } from 'redis';

export const maxDuration = 60;

/**
 * GET /api/automations/evaluate
 *
 * Cron endpoint — evaluates all active automation rules against live Meta
 * data and executes the configured actions (pause, activate, promote).
 * Runs every 5 minutes via Vercel cron. Optionally gated by CRON_SECRET.
 * Capped at AUTOMATION_MAX_ACTIONS_PER_RUN (default 20) actions per run.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const auth = request.headers.get('authorization');

    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const defaultAdAccountId =
    session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  let redisClient: RedisClientType | null = null;

  if (process.env.REDIS_URL) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
      await redisClient.connect();
    } catch (e) {
      console.error('[Evaluate] Redis connection error:', e);
      redisClient = null;
    }
  }

  const store = new RulesStoreService(redisClient);
  const activeRules = await store.getActive();

  if (activeRules.length === 0) {
    return NextResponse.json({ evaluated: 0, results: [] });
  }

  const rulesByAccount: Record<string, typeof activeRules> = {};

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
      console.error(`[Evaluate] Failed to get optimization map for account ${adAccountId}:`, e);
    }

    for (const rule of accountRules) {
      try {
        const result = await evaluateRule(
          rule as unknown as Record<string, unknown>,
          meta,
          adAccountId,
          optimizationMap,
          false,
          false,
          actionCap
        );

        results.push(...result);
      } catch (error) {
        console.error(`[Evaluate] Rule "${rule.name}" (account ${adAccountId}) error:`, error);
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
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const rawAdAccountId =
    session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken || !rawAdAccountId) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  const body = await request.json();
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
    console.error('[Evaluate] Failed to get optimization map:', e);
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

async function evaluateRule(
  rule: Record<string, unknown>,
  meta: MetaService,
  adAccountId: string,
  optimizationMap: Record<string, string>,
  dryRun = false,
  sendSlack = false,
  actionCap?: { executed: number; max: number }
): Promise<unknown[]> {
  const nodes = rule.nodes as Array<Record<string, unknown>>;
  const triggerNode = nodes.find((n) => n.type === 'trigger');
  const conditionNodes = nodes.filter((n) => n.type === 'condition');
  const actionNode = nodes.find((n) => n.type === 'action');

  if (!triggerNode || !actionNode) return [];

  const triggerConfig = (triggerNode.data as Record<string, Record<string, unknown>>)?.config || {};
  const actionConfig = (actionNode.data as Record<string, Record<string, unknown>>)?.config || {};
  const entityType = (triggerConfig.entity_type as string) || 'ad';
  const datePreset = (triggerConfig.date_preset as string) || 'last_7d';

  let insightsData: Array<Record<string, unknown>> = [];
  const activeAdFilter = JSON.stringify([
    { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] },
  ]);
  const activeAdSetFilter = JSON.stringify([
    { field: 'adset.effective_status', operator: 'IN', value: ['ACTIVE'] },
  ]);
  const activeCampaignFilter = JSON.stringify([
    { field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] },
  ]);

  if (entityType === 'ad') {
    const campaignId = triggerConfig.campaign_id as string | undefined;
    const endpoint = campaignId ? `/${campaignId}/insights` : `/act_${adAccountId}/insights`;
    const response = await meta.request(endpoint, {
      params: {
        fields:
          'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'ad',
        limit: '500',
        filtering: activeAdFilter,
      },
    });

    insightsData = (response as { data?: Array<Record<string, unknown>> }).data || [];
  } else if (entityType === 'adset') {
    const response = await meta.request(`/act_${adAccountId}/insights`, {
      params: {
        fields:
          'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'adset',
        limit: '200',
        filtering: activeAdSetFilter,
      },
    });

    insightsData = (response as { data?: Array<Record<string, unknown>> }).data || [];

    if (triggerConfig.campaign_id) {
      insightsData = insightsData.filter((row) => row.campaign_id === triggerConfig.campaign_id);
    }
  } else if (entityType === 'campaign') {
    const response = await meta.request(`/act_${adAccountId}/insights`, {
      params: {
        fields:
          'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'campaign',
        limit: '100',
        filtering: activeCampaignFilter,
      },
    });

    insightsData = (response as { data?: Array<Record<string, unknown>> }).data || [];

    if (triggerConfig.campaign_id) {
      insightsData = insightsData.filter((row) => row.campaign_id === triggerConfig.campaign_id);
    }
  }

  if (insightsData.length === 0 && !dryRun) {
    console.warn(
      `[Evaluate] No data returned for account ${adAccountId} (rule: "${rule.name}") — skipping to avoid false pauses`
    );

    return [{ rule: rule.name, skipped: 'no_data_returned', account: adAccountId }];
  }

  const results: unknown[] = [];

  for (const row of insightsData) {
    const entityId = (row.ad_id || row.adset_id || row.campaign_id) as string;
    const entityName = (row.ad_name || row.adset_name || row.campaign_name || entityId) as string;
    const spend = parseFloat((row.spend as string) || '0');
    const campaignId = row.campaign_id as string;
    const resultCount = getResultCount(row, campaignId, optimizationMap);
    const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

    const metrics: Record<string, number> = {
      spend,
      impressions: parseInt((row.impressions as string) || '0'),
      clicks: parseInt((row.clicks as string) || '0'),
      ctr: parseFloat((row.ctr as string) || '0'),
      cpc: parseFloat((row.cpc as string) || '0'),
      cpm: parseFloat((row.cpm as string) || '0'),
      frequency: parseFloat((row.frequency as string) || '0'),
      results: resultCount,
      cost_per_result: costPerResult === Infinity ? 99999 : costPerResult,
    };

    let allConditionsMet = true;

    for (const condNode of conditionNodes) {
      const config = (condNode.data as Record<string, Record<string, unknown>>)?.config || {};
      const metric = (config.metric as string) || 'spend';
      const operator = (config.operator as string) || '>';
      const threshold = parseFloat((config.threshold as string) || '0');
      const actual = metrics[metric] ?? 0;

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

    const actionType = actionConfig.action_type as string;
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
        const targetAdSetId = actionConfig.target_adset_id as string;

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
          const testPrefix = dryRun ? '🧪 *[TEST]* ' : '';

          await sendSlackNotification(
            actionConfig.slack_channel as string,
            rule.name as string,
            actionType,
            entityType,
            entityId,
            entityName,
            metrics,
            adAccountId,
            actionResult.duplicated_ad_id as string | undefined,
            actionConfig.slack_message as string | undefined,
            testPrefix
          );
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

function getResultCount(
  row: Record<string, unknown>,
  campaignId: string,
  optimizationMap: Record<string, string>
): number {
  if (!row.actions || !Array.isArray(row.actions)) return 0;

  const resultType = campaignId && optimizationMap[campaignId];

  if (resultType) {
    const found = (row.actions as Array<{ action_type: string; value: string }>).find(
      (a) => a.action_type === resultType
    );

    return found ? parseInt(found.value) || 0 : 0;
  }

  const conversion = (row.actions as Array<{ action_type: string; value: string }>).find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.')) &&
      !a.action_type.includes('post_engagement') &&
      !a.action_type.includes('page_engagement') &&
      !a.action_type.includes('link_click')
  );

  return conversion ? parseInt(conversion.value) || 0 : 0;
}

function evaluateCondition(actual: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case '>':
      return actual > threshold;
    case '<':
      return actual < threshold;
    case '>=':
      return actual >= threshold;
    case '<=':
      return actual <= threshold;
    case '==':
      return actual === threshold;
    default:
      return false;
  }
}

async function sendSlackNotification(
  channel: string,
  ruleName: string,
  actionType: string,
  entityType: string,
  entityId: string,
  entityName: string,
  metrics: Record<string, number>,
  adAccountId: string,
  duplicatedAdId?: string,
  customMessage?: string,
  prefix?: string
) {
  const encodedName = encodeURIComponent(`"[\\\"${entityName}\\\"]"`);
  const filterSet = `SEARCH_BY_ADGROUP_NAME-STRING%1ECONTAINS_ALL%1E${encodedName}`;
  const adManagerLink = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${adAccountId}&filter_set=${filterSet}&selected_ad_ids=${entityId}&nav_source=ads_manager`;

  let actionEmoji = '⏸️';
  let actionVerb = 'Paused';

  if (actionType === 'promote') {
    actionEmoji = '🚀';
    actionVerb = 'Promoted';
  } else if (actionType === 'activate') {
    actionEmoji = '▶️';
    actionVerb = 'Activated';
  }

  const resultDisplay = metrics.results || 0;
  const cpaDisplay =
    metrics.cost_per_result === 99999 ? 'N/A' : `$${metrics.cost_per_result.toFixed(2)}`;
  const testPrefix = prefix || '';

  let text: string;

  if (customMessage) {
    text =
      testPrefix +
      customMessage
        .replace(/\{rule_name\}/g, ruleName)
        .replace(/\{action\}/g, actionVerb)
        .replace(/\{entity_type\}/g, entityType)
        .replace(/\{entity_name\}/g, entityName)
        .replace(/\{ad_link\}/g, `<${adManagerLink}|${entityName}>`)
        .replace(/\{spend\}/g, `$${metrics.spend.toFixed(2)}`)
        .replace(/\{results\}/g, String(resultDisplay))
        .replace(/\{cpa\}/g, cpaDisplay)
        .replace(/\{clicks\}/g, String(metrics.clicks || 0))
        .replace(/\{ctr\}/g, `${(metrics.ctr || 0).toFixed(2)}%`);
  } else {
    text = `${testPrefix}${actionEmoji} *${ruleName}*\n`;
    text += `${actionVerb} ${entityType}: <${adManagerLink}|${entityName}>\n`;
    text += `Spend: $${metrics.spend.toFixed(2)} · Results: ${resultDisplay} · CPA: ${cpaDisplay}`;
  }

  if (duplicatedAdId) {
    const dupEncodedName = encodeURIComponent(`"[\\\"${entityName} [Winner Copy]\\\"]"`);
    const dupFilterSet = `SEARCH_BY_ADGROUP_NAME-STRING%1ECONTAINS_ALL%1E${dupEncodedName}`;
    const dupLink = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${adAccountId}&filter_set=${dupFilterSet}&selected_ad_ids=${duplicatedAdId}&nav_source=ads_manager`;

    text += `\n📋 Duplicated to winners ad set: <${dupLink}|View new ad>`;
  }

  try {
    const slack = new SlackService(
      process.env.SLACK_BOT_TOKEN || '',
      process.env.SLACK_SIGNING_SECRET || ''
    );

    await slack.postMessage(channel, text);
  } catch (e) {
    console.error('[Evaluate] Slack notification failed:', e);
  }
}
