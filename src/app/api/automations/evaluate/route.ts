import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { cookies } from 'next/headers';
import {
  metaApi,
  updateStatus,
  duplicateAd,
  getAdLevelInsights,
  getCampaignOptimizationMap,
} from '@/lib/meta-api';
import { postSlackMessage } from '@/lib/slack';

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
export async function GET() {
  // Try session first, fall back to system token for cron jobs
  const session = await getSession();
  const accessToken = session?.meta_access_token || process.env.META_SYSTEM_ACCESS_TOKEN;
  const rawAdAccountId = session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken || !rawAdAccountId) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  // Read rules from per-rule cookies
  const cookieStore = await cookies();
  const allRules: any[] = [];
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('wonderly_rule_')) {
      try { allRules.push(JSON.parse(cookie.value)); } catch { /* skip */ }
    }
  }
  const activeRules = allRules.filter((r: any) => r.is_active);

  if (activeRules.length === 0) {
    return NextResponse.json({ evaluated: 0, results: [] });
  }

  // Get optimization map once for all rules (to compute results/CPA)
  let optimizationMap: Record<string, string> = {};
  try {
    optimizationMap = await getCampaignOptimizationMap(rawAdAccountId, accessToken);
  } catch (e) {
    console.error('[Evaluate] Failed to get optimization map:', e);
  }

  const results: any[] = [];

  for (const rule of activeRules) {
    try {
      const result = await evaluateRule(rule, rawAdAccountId, accessToken, optimizationMap, false);
      results.push(...result);
    } catch (error) {
      console.error(`[Evaluate] Rule "${rule.name}" error:`, error);
      results.push({ rule: rule.name, error: String(error) });
    }
  }

  return NextResponse.json({ evaluated: activeRules.length, results });
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
  const rawAdAccountId = session?.ad_account_id || (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

  if (!accessToken || !rawAdAccountId) {
    return NextResponse.json({ error: 'No Meta credentials available' }, { status: 401 });
  }

  const body = await request.json();
  const rule = body.rule;
  const sendSlack = body.send_slack === true;

  if (!rule) {
    return NextResponse.json({ error: 'Rule required' }, { status: 400 });
  }

  let optimizationMap: Record<string, string> = {};
  try {
    optimizationMap = await getCampaignOptimizationMap(rawAdAccountId, accessToken);
  } catch (e) {
    console.error('[Evaluate Test] Failed to get optimization map:', e);
  }

  try {
    const results = await evaluateRule(rule, rawAdAccountId, accessToken, optimizationMap, true, sendSlack);
    return NextResponse.json({
      test: true,
      dry_run: true,
      send_slack: sendSlack,
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
  sendSlack: boolean = false
): Promise<any[]> {
  const triggerNode = rule.nodes.find((n: any) => n.type === 'trigger');
  const conditionNodes = rule.nodes.filter((n: any) => n.type === 'condition');
  const actionNode = rule.nodes.find((n: any) => n.type === 'action');

  if (!triggerNode || !actionNode) return [];

  const triggerConfig = triggerNode.data?.config || {};
  const actionConfig = actionNode.data?.config || {};
  const entityType = triggerConfig.entity_type || 'ad';
  const datePreset = triggerConfig.date_preset || 'today';

  // Determine which entities to scan
  let insightsData: any[] = [];

  if (entityType === 'ad') {
    const campaignId = triggerConfig.campaign_id;

    if (campaignId) {
      // Use campaign-scoped endpoint for accurate results (avoids pagination limits)
      const response = await metaApi(`/${campaignId}/insights`, accessToken, {
        params: {
          fields: 'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type',
          date_preset: datePreset,
          level: 'ad',
          limit: '500',
        },
      });
      insightsData = response.data || [];
    } else {
      // No campaign filter — fetch account-wide
      const response = await getAdLevelInsights(adAccountId, accessToken, datePreset);
      insightsData = response.data || [];
    }
  } else if (entityType === 'adset') {
    const response = await metaApi(`/act_${adAccountId}/insights`, accessToken, {
      params: {
        fields: 'adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'adset',
        limit: '200',
      },
    });
    insightsData = response.data || [];
    if (triggerConfig.campaign_id) {
      insightsData = insightsData.filter((row: any) => row.campaign_id === triggerConfig.campaign_id);
    }
  } else if (entityType === 'campaign') {
    const response = await metaApi(`/act_${adAccountId}/insights`, accessToken, {
      params: {
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type',
        date_preset: datePreset,
        level: 'campaign',
        limit: '100',
      },
    });
    insightsData = response.data || [];
    if (triggerConfig.campaign_id) {
      insightsData = insightsData.filter((row: any) => row.campaign_id === triggerConfig.campaign_id);
    }
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
      metrics: { spend, results: resultCount, cost_per_result: costPerResult === Infinity ? 'N/A' : costPerResult.toFixed(2) },
    };

    try {
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
      } else if (actionType === 'activate') {
        await updateStatus(entityId, accessToken, 'ACTIVE');
        actionResult.action = 'activated';
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
      }

      // Send Slack notification (always in live mode; in test mode only when sendSlack is true)
      if (actionConfig.slack_channel && (actionConfig.also_notify_slack === 'true' || actionConfig.also_notify_slack === true)) {
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
  const conversion = row.actions.find((a: any) =>
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
    case '>': return actual > threshold;
    case '<': return actual < threshold;
    case '>=': return actual >= threshold;
    case '<=': return actual <= threshold;
    case '==': return actual === threshold;
    default: return false;
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
  // Link directly to this ad in Meta Ads Manager
  // selected_ad_ids highlights the ad; adding the ad-level view ensures Ads tab is active
  const adManagerLink = `https://business.facebook.com/adsmanager/manage/ads?act=${adAccountId}&selected_ad_ids=${entityId}&nav_source=no_referrer`;

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
  const cpaDisplay = metrics.cost_per_result === 99999 ? 'N/A' : `$${metrics.cost_per_result.toFixed(2)}`;

  let text: string;

  const testPrefix = prefix || '';

  if (customMessage) {
    // Replace template variables in custom message
    text = testPrefix + customMessage
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
    const dupLink = `https://www.facebook.com/adsmanager/manage/ads?act=${adAccountId}&selected_ad_ids=${duplicatedAdId}`;
    text += `\n📋 Duplicated to winners ad set: <${dupLink}|View new ad>`;
  }

  try {
    await postSlackMessage(channel, text);
  } catch (e) {
    console.error('[Evaluate] Slack notification failed:', e);
  }
}
