import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { metaApi, updateStatus, duplicateAd, getCampaignOptimizationMap } from '@/lib/meta-api';
import { postSlackMessage } from '@/lib/slack';
import { getActiveRules } from '@/lib/rules-store';

export const maxDuration = 60;

/**
 * GET /api/automations/evaluate
 *
 * Evaluates all active automation rules against live Meta data.
 * Can be triggered by Vercel cron or manually.
 *
 * Supports:
 * - Scanning all ads within a campaign (campaign_id filter)
 * - Multiple AND conditions (results, cost_per_result, spend, ctr, cpc, etc.)
 * - Actions: pause, activate, promote (pause + duplicate to winner ad set)
 * - Slack notifications to configurable channels with ad hyperlinks
 */
export async function GET(request: NextRequest) {
  // Protect against unauthorized cron triggers when CRON_SECRET is configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Try session first, fall back to system token for cron jobs
  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const defaultAdAccountId =
    session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  // Read ALL active rules (across all accounts)
  const activeRules = await getActiveRules();

  if (activeRules.length === 0) {
    return NextResponse.json({ evaluated: 0, results: [] });
  }

  // Group rules by ad account ID
  const rulesByAccount: Record<string, typeof activeRules> = {};
  for (const rule of activeRules) {
    const accountId = rule.ad_account_id || defaultAdAccountId;
    if (!accountId) continue;
    if (!rulesByAccount[accountId]) rulesByAccount[accountId] = [];
    rulesByAccount[accountId].push(rule);
  }

  const results: any[] = [];

  // Cap total live actions per cron run to prevent runaway automation
  const actionCap = {
    executed: 0,
    max: parseInt(process.env.AUTOMATION_MAX_ACTIONS_PER_RUN || '20'),
  };

  // Evaluate rules for each account
  for (const [adAccountId, accountRules] of Object.entries(rulesByAccount)) {
    // Get optimization map for this account
    let optimizationMap: Record<string, string> = {};
    try {
      optimizationMap = await getCampaignOptimizationMap(adAccountId, accessToken);
    } catch (e) {
      console.error(`[Evaluate] Failed to get optimization map for account ${adAccountId}:`, e);
    }

    for (const rule of accountRules) {
      try {
        const result = await evaluateRule(
          rule,
          adAccountId,
          accessToken,
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
 * Test a specific rule. No pause/promote actions are taken, but Slack messages
 * ARE sent when send_slack is true so you can preview the real notification.
 *
 * Body: { rule: RuleObject, send_slack?: boolean }
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
  const live = body.live === true; // Actually execute actions (pause/promote)

  if (!rule) {
    return NextResponse.json({ error: 'Rule required' }, { status: 400 });
  }

  let optimizationMap: Record<string, string> = {};
  try {
    optimizationMap = await getCampaignOptimizationMap(rawAdAccountId, accessToken);
  } catch (e) {
    console.error('[Evaluate] Failed to get optimization map:', e);
  }

  try {
    const dryRun = !live;
    const results = await evaluateRule(
      rule,
      rawAdAccountId,
      accessToken,
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

/**
 * Evaluate a single rule against all matching entities
 */
async function evaluateRule(
  rule: any,
  adAccountId: string,
  accessToken: string,
  optimizationMap: Record<string, string>,
  dryRun: boolean = false,
  sendSlack: boolean = false,
  actionCap?: { executed: number; max: number }
): Promise<any[]> {
  const triggerNode = rule.nodes.find((n: any) => n.type === 'trigger');
  const conditionNodes = rule.nodes.filter((n: any) => n.type === 'condition');
  const actionNode = rule.nodes.find((n: any) => n.type === 'action');

  if (!triggerNode || !actionNode) return [];

  const triggerConfig = triggerNode.data?.config || {};
  const actionConfig = actionNode.data?.config || {};
  const entityType = triggerConfig.entity_type || 'ad';
  const datePreset = triggerConfig.date_preset || 'last_7d';

  // Determine which entities to scan — only ACTIVE entities (skip paused/off)
  let insightsData: any[] = [];
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
    const campaignId = triggerConfig.campaign_id;

    if (campaignId) {
      const response = await metaApi(`/${campaignId}/insights`, accessToken, {
        params: {
          fields:
            'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type',
          date_preset: datePreset,
          level: 'ad',
          limit: '500',
          filtering: activeAdFilter,
        },
      });
      insightsData = response.data || [];
    } else {
      const response = await metaApi(`/act_${adAccountId}/insights`, accessToken, {
        params: {
          fields:
            'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type',
          date_preset: datePreset,
          level: 'ad',
          limit: '500',
          filtering: activeAdFilter,
        },
      });
      insightsData = response.data || [];
    }
  } else if (entityType === 'adset') {
    const response = await metaApi(`/act_${adAccountId}/insights`, accessToken, {
      params: {
        fields:
          'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'adset',
        limit: '200',
        filtering: activeAdSetFilter,
      },
    });
    insightsData = response.data || [];
    if (triggerConfig.campaign_id) {
      insightsData = insightsData.filter(
        (row: any) => row.campaign_id === triggerConfig.campaign_id
      );
    }
  } else if (entityType === 'campaign') {
    const response = await metaApi(`/act_${adAccountId}/insights`, accessToken, {
      params: {
        fields:
          'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'campaign',
        limit: '100',
        filtering: activeCampaignFilter,
      },
    });
    insightsData = response.data || [];
    if (triggerConfig.campaign_id) {
      insightsData = insightsData.filter(
        (row: any) => row.campaign_id === triggerConfig.campaign_id
      );
    }
  }

  // Guard: skip live evaluation when Meta returns no data (likely a reporting outage)
  if (insightsData.length === 0 && !dryRun) {
    console.warn(
      `[Evaluate] No data returned for account ${adAccountId} (rule: "${rule.name}") — skipping to avoid false pauses`
    );
    return [{ rule: rule.name, skipped: 'no_data_returned', account: adAccountId }];
  }

  const results: any[] = [];

  for (const row of insightsData) {
    const entityId = row.ad_id || row.adset_id || row.campaign_id;
    const entityName = row.ad_name || row.adset_name || row.campaign_name || entityId;

    // Compute derived metrics
    const spend = parseFloat(row.spend || '0');
    const campaignId = row.campaign_id;
    const resultCount = getResultCount(row, campaignId, optimizationMap);
    const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

    // Build a metrics object for condition evaluation
    const metrics: Record<string, number> = {
      spend,
      impressions: parseInt(row.impressions || '0'),
      clicks: parseInt(row.clicks || '0'),
      ctr: parseFloat(row.ctr || '0'),
      cpc: parseFloat(row.cpc || '0'),
      cpm: parseFloat(row.cpm || '0'),
      frequency: parseFloat(row.frequency || '0'),
      results: resultCount,
      cost_per_result: costPerResult === Infinity ? 99999 : costPerResult,
    };

    // Evaluate ALL conditions (AND logic)
    let allConditionsMet = true;
    for (const condNode of conditionNodes) {
      const config = condNode.data?.config || {};
      const metric = config.metric || 'spend';
      const operator = config.operator || '>';
      const threshold = parseFloat(config.threshold || '0');
      const actual = metrics[metric] ?? 0;

      // Skip CPA conditions when results=0 — CPA is undefined, not infinitely high
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

    // All conditions met — execute action
    const actionType = actionConfig.action_type;
    const actionResult: any = {
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
      // Enforce action cap for live runs
      if (!dryRun && actionCap && actionCap.executed >= actionCap.max) {
        actionResult.action = 'skipped';
        actionResult.skipped = 'action_cap_reached';
        results.push(actionResult);
        continue;
      }

      if (dryRun) {
        // Dry run — just report what WOULD happen
        actionResult.action = `would_${actionType}`;
        actionResult.dry_run = true;
        if (actionType === 'promote' && !actionConfig.target_adset_id) {
          actionResult.warning = 'No target ad set ID configured for promotion';
        }
      } else if (actionType === 'pause') {
        await updateStatus(entityId, accessToken, 'PAUSED');
        actionResult.action = 'paused';
        if (actionCap) actionCap.executed++;
      } else if (actionType === 'activate') {
        await updateStatus(entityId, accessToken, 'ACTIVE');
        actionResult.action = 'activated';
        if (actionCap) actionCap.executed++;
      } else if (actionType === 'promote') {
        // Promote = pause original + duplicate to winner ad set
        await updateStatus(entityId, accessToken, 'PAUSED');
        const targetAdSetId = actionConfig.target_adset_id;
        if (targetAdSetId) {
          const duplicated = await duplicateAd(entityId, targetAdSetId, adAccountId, accessToken);
          actionResult.action = 'promoted';
          actionResult.duplicated_ad_id = duplicated.id;
        } else {
          actionResult.action = 'paused (no target adset for duplication)';
        }
        if (actionCap) actionCap.executed++;
      }

      // Send Slack notification (always in live mode; in test mode only when sendSlack is true)
      if (
        actionConfig.slack_channel &&
        (actionConfig.also_notify_slack === 'true' || actionConfig.also_notify_slack === true)
      ) {
        if (!dryRun || sendSlack) {
          const testPrefix = dryRun ? '🧪 *[TEST]* ' : '';
          await sendSlackNotification(
            actionConfig.slack_channel,
            rule.name,
            actionType,
            entityType,
            entityId,
            entityName,
            metrics,
            adAccountId,
            actionResult.duplicated_ad_id,
            actionConfig.slack_message,
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

/**
 * Get result count from an insight row using the optimization map
 */
function getResultCount(
  row: any,
  campaignId: string,
  optimizationMap: Record<string, string>
): number {
  if (!row.actions || !Array.isArray(row.actions)) return 0;

  const resultType = campaignId && optimizationMap[campaignId];

  if (resultType) {
    const found = row.actions.find((a: any) => a.action_type === resultType);
    return found ? parseInt(found.value) || 0 : 0;
  }

  // Fallback for campaigns not in optimization map
  const conversion = row.actions.find(
    (a: any) =>
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

/**
 * Send a rich Slack notification with ad link
 */
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
  // Link directly to this ad in Meta Ads Manager with name filter pre-applied
  // Uses filter_set=SEARCH_BY_ADGROUP_NAME-STRING<RS>CONTAINS_ALL<RS>"[\"ad name\"]" format
  // where <RS> is the record separator character %1E
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

  let text: string;

  const testPrefix = prefix || '';

  if (customMessage) {
    // Replace template variables in custom message
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
    // Default message format
    text = `${testPrefix}${actionEmoji} *${ruleName}*\n`;
    text += `${actionVerb} ${entityType}: <${adManagerLink}|${entityName}>\n`;
    text += `Spend: $${metrics.spend.toFixed(2)} · Results: ${resultDisplay} · CPA: ${cpaDisplay}`;
  }

  if (duplicatedAdId) {
    // Use same filter_set format so the link opens directly to the new ad
    const dupEncodedName = encodeURIComponent(`"[\\\"${entityName} [Winner Copy]\\\"]"`);
    const dupFilterSet = `SEARCH_BY_ADGROUP_NAME-STRING%1ECONTAINS_ALL%1E${dupEncodedName}`;
    const dupLink = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${adAccountId}&filter_set=${dupFilterSet}&selected_ad_ids=${duplicatedAdId}&nav_source=ads_manager`;
    text += `\n📋 Duplicated to winners ad set: <${dupLink}|View new ad>`;
  }

  try {
    await postSlackMessage(channel, text);
  } catch (e) {
    console.error('[Evaluate] Slack notification failed:', e);
  }
}
