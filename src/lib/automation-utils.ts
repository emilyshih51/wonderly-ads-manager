/**
 * Automation utility functions — shared pure logic for the rule evaluation engine.
 *
 * These functions are used by the automation cron job (`/api/automations/evaluate`),
 * the rule preview tool (`/api/automations/search`), and the Slack bot
 * (`/api/slack/events`) to compute metrics from Meta insights rows.
 *
 * All functions are pure (no side effects) so they can be unit tested in isolation.
 */

import type { MetaInsightsRow } from '@/types';

export const COST_PER_RESULT_NO_DATA = 99999;

/** Minimum allowed daily budget in dollars after any adjustment. */
export const MIN_DAILY_BUDGET_DOLLARS = 1;

/** Maximum multiplier for a single budget adjustment step (prevents runaway increases). */
export const MAX_BUDGET_STEP_MULTIPLIER = 10;

/**
 * Calculate a new daily budget in cents after an adjust_budget automation action.
 *
 * Applies the direction and amount type to the current budget, then clamps
 * the result to safe bounds: minimum `MIN_DAILY_BUDGET_DOLLARS` and maximum
 * `MAX_BUDGET_STEP_MULTIPLIER`× the current budget per step.
 *
 * @param currentBudgetCents - Current daily budget in the account currency's smallest unit
 * @param direction - Whether to increase or decrease the budget
 * @param amountType - Whether `amount` is a percentage or a fixed dollar value
 * @param amount - Magnitude of the adjustment (e.g. 10 for 10% or $10)
 * @returns New daily budget in cents, clamped to safe bounds
 */
export function calculateNewBudget(
  currentBudgetCents: number,
  direction: 'increase' | 'decrease',
  amountType: 'percent' | 'fixed',
  amount: number
): number {
  const currentDollars = currentBudgetCents / 100;

  let newDollars: number;

  if (amountType === 'percent') {
    const factor = direction === 'increase' ? 1 + amount / 100 : 1 - amount / 100;
    newDollars = currentDollars * factor;
  } else {
    newDollars = direction === 'increase' ? currentDollars + amount : currentDollars - amount;
  }

  newDollars = Math.max(MIN_DAILY_BUDGET_DOLLARS, newDollars);
  newDollars = Math.min(newDollars, currentDollars * MAX_BUDGET_STEP_MULTIPLIER);

  return Math.round(newDollars * 100);
}

export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==';

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
 * excluding engagement-only events.
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
    const found = actions.find((a) => a.action_type === resultType);

    return found ? parseInt(found.value) || 0 : 0;
  }

  // Generic fallback — find the first conversion action, excluding non-conversion events.
  // Includes standalone 'lead' and 'complete_registration' action types that Meta
  // sometimes returns for certain campaign objectives.
  const conversion = actions.find(
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

export interface ParsedMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  results: number;
  cost_per_result: number;
}

/** Parse numeric metrics from a Meta insights row. */
export function parseInsightMetrics(
  row: MetaInsightsRow,
  optimizationMap: Record<string, string>
): ParsedMetrics {
  const spend = parseFloat(row.spend ?? '0');
  const campaignId = row.campaign_id;
  const resultCount = getResultCount(row, campaignId, optimizationMap);
  const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

  return {
    spend,
    impressions: parseInt(row.impressions ?? '0', 10),
    clicks: parseInt(row.clicks ?? '0', 10),
    ctr: parseFloat(row.ctr ?? '0'),
    cpc: parseFloat(row.cpc ?? '0'),
    cpm: parseFloat(row.cpm ?? '0'),
    frequency: parseFloat(row.frequency ?? '0'),
    results: resultCount,
    cost_per_result: costPerResult === Infinity ? COST_PER_RESULT_NO_DATA : costPerResult,
  };
}
