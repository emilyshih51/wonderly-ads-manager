/**
 * Automation utility functions — shared pure logic for the rule evaluation engine.
 *
 * These functions are used by the automation cron job (`/api/automations/evaluate`),
 * the rule preview tool (`/api/automations/search`), and the Slack bot
 * (`/api/slack/events`) to compute metrics from Meta insights rows.
 *
 * All functions are pure (no side effects) so they can be unit tested in isolation.
 */

import type { MetaAction, MetaInsightsRow } from '@/types';

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
 * Extract the core event name from a Meta action type string.
 * Strips prefixes like `offsite_conversion.fb_pixel_`, `onsite_conversion.`,
 * and `omni_` to produce a canonical name for fuzzy matching.
 *
 * @example
 * ```ts
 * extractEventName('offsite_conversion.fb_pixel_complete_registration') // → 'complete_registration'
 * extractEventName('omni_complete_registration') // → 'complete_registration'
 * extractEventName('complete_registration') // → 'complete_registration'
 * extractEventName('start_trial_website') // → 'start_trial'
 * ```
 */
function extractEventName(actionType: string): string {
  return (
    actionType
      // Strip attribution window suffixes Meta appends when action_attribution_windows
      // is specified (e.g. `.7d_click`, `.1d_view`, `.28d_click`). Must run first so
      // the remaining replacements match the bare action type name.
      .replace(/\.\d+d_(click|view)$/, '')
      .replace(/^offsite_conversion\.fb_pixel_/, '')
      .replace(/^offsite_conversion\.custom\./, 'custom.')
      .replace(/^offsite_conversion\./, '')
      .replace(/^onsite_app_conversion\./, '')
      .replace(/^onsite_conversion\./, '')
      .replace(/^omni_/, '')
      // Newer standard pixel events (StartTrial, Subscribe, Schedule, …) are reported
      // as `<event>_website` rather than `offsite_conversion.fb_pixel_<event>`.
      .replace(/_website$/, '')
  );
}

/**
 * Read the numeric count from a Meta action object.
 *
 * When `action_attribution_windows` is specified in the insights query, Meta sets
 * `value` to the count for the `default_attribution_window` (we request `7d_click`).
 * As a defensive fallback, if `value` is absent or zero, this function checks for
 * an explicit `7d_click` key on the object — Meta attaches per-window breakdowns as
 * additional keys alongside `value`.
 *
 * @param action - A Meta action object from the insights `actions` array
 * @returns The action count as an integer, or 0 if no count can be determined
 */
function readActionValue(action: MetaAction): number {
  const v = parseInt(action.value);

  if (!isNaN(v) && v > 0) return v;

  // Defensive fallback: try the explicit 7d_click key that Meta attaches when
  // action_attribution_windows is requested. This protects against value being
  // absent or set to a narrower window count that is 0.
  const record = action as unknown as Record<string, string>;
  const windowValue = parseInt(record['7d_click'] ?? record['28d_click'] ?? '0');

  return windowValue > 0 ? windowValue : isNaN(v) ? 0 : v;
}

/** Action type for the catch-all bucket of every custom pixel event on an ad. */
const CUSTOM_EVENT_BUCKET = 'offsite_conversion.fb_pixel_custom';

/**
 * Whether a mapped result type is one Meta reports in the insights `conversions` field
 * (newer standard events such as `start_trial_website`) rather than in `actions`.
 */
function isConversionsFieldType(resultType: string): boolean {
  return resultType.endsWith('_website');
}

/**
 * Find a mapped result type in a list of Meta actions: exact match first, then a fuzzy
 * match on the core event name (Meta varies prefixes across API versions, e.g.
 * `omni_complete_registration` vs `offsite_conversion.fb_pixel_complete_registration`).
 */
function findResultAction(actions: MetaAction[], resultType: string): MetaAction | undefined {
  const exact = actions.find((a) => a.action_type === resultType);

  if (exact) return exact;

  const expectedEvent = extractEventName(resultType);

  return expectedEvent
    ? actions.find((a) => extractEventName(a.action_type) === expectedEvent)
    : undefined;
}

/**
 * Extract the result count ("Results" in Ads Manager) from a Meta insights row.
 *
 * When the optimization goal is known (via the optimization map), counts only that event.
 * Newer standard pixel events — Start Trial, Subscribe, Schedule, … — are reported by Meta
 * in the insights `conversions` field (e.g. `start_trial_website`), NOT in `actions`, so
 * both arrays are searched. If the row was fetched without the `conversions` field, falls
 * back to the legacy custom-event bucket so a caller that forgot to request it can never
 * silently read 0 (and lose converter protection / trigger 0-result pauses).
 *
 * Falls back to the first conversion-type action when no optimization goal is known.
 *
 * @param row - Insights row with `actions` (and ideally `conversions`)
 * @param lookupId - Ad set or campaign ID used to look up the optimization goal
 * @param optimizationMap - Map of ID → Meta action type counted as a result
 * @returns The result count, or 0
 */
export function getResultCount(
  row: Pick<MetaInsightsRow, 'actions' | 'conversions' | 'adset_id' | 'campaign_id'>,
  lookupId: string | undefined,
  optimizationMap: Record<string, string>
): number {
  const actions = Array.isArray(row.actions) ? row.actions : [];
  const conversions = Array.isArray(row.conversions) ? row.conversions : undefined;
  const resultType = lookupId && optimizationMap[lookupId];

  if (resultType) {
    if (isConversionsFieldType(resultType)) {
      if (conversions) {
        const found = findResultAction(conversions, resultType);

        return found ? readActionValue(found) : 0;
      }

      // `conversions` wasn't requested for this row — keep the legacy (over-)count rather
      // than reporting 0 results for an ad that may have converted.
      const legacy = actions.find((a) => a.action_type === CUSTOM_EVENT_BUCKET);

      return legacy ? readActionValue(legacy) : 0;
    }

    const found = findResultAction(actions, resultType);

    // If neither exact nor fuzzy match found it, this ad has 0 of its target conversion.
    return found ? readActionValue(found) : 0;
  }

  // Generic fallback — find the first conversion action, excluding non-conversion events.
  // Includes `omni_` prefixed actions (Meta's newer cross-platform format),
  // standalone `lead` and `complete_registration` action types, and traditional
  // `offsite_conversion.*` / `onsite_conversion.*` types.
  const conversion = actions.find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.') ||
        a.action_type.startsWith('omni_') ||
        a.action_type === 'lead' ||
        a.action_type === 'complete_registration') &&
      !a.action_type.includes('post_engagement') &&
      !a.action_type.includes('page_engagement') &&
      !a.action_type.includes('link_click')
  );

  return conversion ? readActionValue(conversion) : 0;
}

/**
 * Compute the cost-per-result for a Meta insights row.
 *
 * @param row - A Meta insights row with `spend` and `actions` fields
 * @param lookupId - ID used to look up the optimization goal (ad set ID or campaign ID)
 * @param optimizationMap - Map of ID → Meta action type string (keyed by ad set or campaign)
 * @returns Cost per result as a number, or `null` when there are zero results
 */
export function getCostPerResult(
  row: Pick<MetaInsightsRow, 'spend' | 'actions' | 'conversions' | 'adset_id' | 'campaign_id'>,
  lookupId: string | undefined,
  optimizationMap: Record<string, string>
): number | null {
  const results = getResultCount(row, lookupId, optimizationMap);

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

/**
 * Parse numeric metrics from a Meta insights row.
 *
 * The optimization map can be keyed by ad set ID or campaign ID. This function
 * tries `adset_id` first (for per-ad-set accuracy), then falls back to
 * `campaign_id` (for campaign-level queries where `adset_id` is absent).
 */
export function parseInsightMetrics(
  row: MetaInsightsRow,
  optimizationMap: Record<string, string>
): ParsedMetrics {
  const spend = parseFloat(row.spend ?? '0');
  // Try ad set first (more accurate), then campaign (for campaign-level data)
  const lookupId =
    (row.adset_id && optimizationMap[row.adset_id] ? row.adset_id : undefined) ?? row.campaign_id;
  const resultCount = getResultCount(row, lookupId, optimizationMap);
  const costPerResult = resultCount > 0 ? spend / resultCount : Infinity;

  return {
    spend,
    impressions: parseInt(row.impressions ?? '0', 10),
    clicks: parseInt(row.clicks ?? '0', 10),
    ctr: parseFloat(row.inline_link_click_ctr ?? row.ctr ?? '0'),
    cpc: parseFloat(row.cpc ?? '0'),
    cpm: parseFloat(row.cpm ?? '0'),
    frequency: parseFloat(row.frequency ?? '0'),
    results: resultCount,
    cost_per_result: costPerResult === Infinity ? COST_PER_RESULT_NO_DATA : costPerResult,
  };
}

/* ─────────── Lifetime-conversion guardrail ─────────── */

/**
 * Meta `date_preset` value for an entity's full lifetime history.
 * (`lifetime` was renamed to `maximum` in Marketing API v10.)
 */
export const LIFETIME_DATE_PRESET = 'maximum';

/**
 * Minimum lifetime conversions that mark an entity as "proven" and therefore
 * protected from destructive automation actions.
 *
 * The product rule is deliberately simple: an ad that has ever converted is
 * never auto-killed; an ad at exactly zero lifetime conversions can be.
 */
export const LIFETIME_CONVERSION_PROTECTION_MIN = 1;

/**
 * True when an entity's lifetime conversion count protects it from destructive
 * automation actions (pause, budget decrease, promote's pause-original).
 *
 * @param lifetimeResults - Lifetime conversion count for the entity
 */
export function hasLifetimeConversions(lifetimeResults: number): boolean {
  return lifetimeResults >= LIFETIME_CONVERSION_PROTECTION_MIN;
}

/**
 * Build a map of entity ID → lifetime conversion count from a set of insight
 * rows fetched with `date_preset=maximum`.
 *
 * Rows are keyed at whichever level they were queried (ad, ad set, campaign).
 * Counts are summed defensively so a duplicated row can never *lower* an
 * entity's protection.
 *
 * @param rows - Insight rows fetched over the lifetime date preset
 * @param optimizationMap - Map of ad set/campaign ID → Meta action type
 */
export function buildLifetimeResultsMap(
  rows: MetaInsightsRow[],
  optimizationMap: Record<string, string>
): Record<string, number> {
  const map: Record<string, number> = {};

  for (const row of rows) {
    const id = row.ad_id ?? row.adset_id ?? row.campaign_id;

    if (!id) continue;

    map[id] = (map[id] ?? 0) + parseInsightMetrics(row, optimizationMap).results;
  }

  return map;
}
