/**
 * Automation utility functions — shared pure logic for the rule evaluation engine.
 *
 * These functions are used by the automation cron job (`/api/automations/evaluate`),
 * the rule preview tool (`/api/automations/search`), and the Slack bot
 * (`/api/slack/events`) to compute metrics from Meta insights rows.
 *
 * All functions are pure (no side effects) so they can be unit tested in isolation.
 */

import type { MetaInsightsRow, MetaAction } from '@/types';

/**
 * Evaluate a numeric condition using a comparison operator.
 *
 * @param actual - The measured metric value
 * @param operator - Comparison operator: `'>'`, `'<'`, `'>='`, `'<='`, or `'=='`
 * @param threshold - The threshold value to compare against
 * @returns `true` if the condition is met, `false` otherwise (including unknown operators)
 */
export function evaluateCondition(actual: number, operator: string, threshold: number): boolean {
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
 * Extract the result count from a Meta insights row's actions array.
 *
 * When the optimization goal is known (via the optimization map), ONLY that specific
 * action type is counted. Otherwise, falls back to the first conversion-type action,
 * excluding engagement-only events (`link_click`, `page_engagement`, etc.).
 *
 * @param row - A Meta insights row containing an `actions` array
 * @param campaignId - Campaign ID used to look up the optimization goal
 * @param optimizationMap - Map of campaign ID → Meta action type string
 * @returns Number of results (conversions), or `0` if none found
 */
export function getResultCount(
  row: Pick<MetaInsightsRow, 'actions' | 'campaign_id'>,
  campaignId: string | undefined,
  optimizationMap: Record<string, string>
): number {
  const actions = row.actions;

  if (!actions || !Array.isArray(actions)) return 0;

  const resultType = campaignId && optimizationMap[campaignId];

  if (resultType) {
    const found = (actions as MetaAction[]).find((a) => a.action_type === resultType);

    return found ? parseInt(found.value) || 0 : 0;
  }

  // Generic fallback — find the first conversion action, excluding non-conversion events.
  // Includes standalone 'lead' and 'complete_registration' action types that Meta
  // sometimes returns for certain campaign objectives.
  const conversion = (actions as MetaAction[]).find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.') ||
        a.action_type === 'lead' ||
        a.action_type === 'complete_registration') &&
      !a.action_type.includes('post_engagement') &&
      !a.action_type.includes('page_engagement') &&
      !a.action_type.includes('link_click')
  );

  return conversion ? parseInt(conversion.value) || 0 : 0;
}

/**
 * Compute the cost-per-result for a Meta insights row.
 *
 * @param row - A Meta insights row with `spend` and `actions` fields
 * @param campaignId - Campaign ID used to look up the optimization goal
 * @param optimizationMap - Map of campaign ID → Meta action type string
 * @returns Cost per result as a number, or `null` when there are zero results
 */
export function getCostPerResult(
  row: Pick<MetaInsightsRow, 'spend' | 'actions' | 'campaign_id'>,
  campaignId: string | undefined,
  optimizationMap: Record<string, string>
): number | null {
  const results = getResultCount(row, campaignId, optimizationMap);

  if (results === 0) return null;

  const spend = parseFloat(row.spend || '0');

  return spend / results;
}
