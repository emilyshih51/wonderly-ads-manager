import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS class names, resolving conflicts via `tailwind-merge`.
 *
 * @param inputs - Any mix of strings, arrays, or conditional class expressions accepted by `clsx`.
 * @returns A single deduplicated, conflict-resolved class string.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a numeric or string value as a USD currency string.
 *
 * @param value - The amount to format. Accepts a number, a numeric string (as returned
 *                by the Meta API), `null`, or `undefined`.
 * @returns A formatted string like `"$1,234.56"`, or `"-"` for empty/invalid input.
 */
export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '-';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format a numeric or string value as a percentage string.
 *
 * @param value - The percentage to format (e.g. `2.34` → `"2.34%"`). Accepts a number,
 *                a numeric string, `null`, or `undefined`.
 * @returns A formatted string like `"2.34%"`, or `"-"` for empty/invalid input.
 */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '-';

  return `${num.toFixed(2)}%`;
}

/**
 * Format a numeric or string value as a locale-aware integer string.
 *
 * @param value - The number to format (e.g. `1234567` → `"1,234,567"`). Accepts a number,
 *                a numeric string, `null`, or `undefined`.
 * @returns A formatted string with thousands separators, or `"-"` for empty/invalid input.
 */
export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num)) return '-';

  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Extract the result count from a Meta actions array.
 *
 * Searches for the first action type that represents a meaningful conversion result
 * (pixel lead, pixel purchase, complete registration, or link click).
 *
 * @param actions - The `actions` array from a Meta insights response.
 * @returns The integer result count, or `0` if no matching action is found.
 */
export function getResultsFromActions(actions?: Array<{ action_type: string; value: string }>) {
  if (!actions) return 0;
  const resultAction = actions.find(
    (a) =>
      a.action_type === 'offsite_conversion.fb_pixel_lead' ||
      a.action_type === 'lead' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
      a.action_type === 'purchase' ||
      a.action_type === 'complete_registration' ||
      a.action_type === 'link_click'
  );

  return resultAction ? parseInt(resultAction.value) : 0;
}

/**
 * Extract the cost-per-result from a Meta `cost_per_action_type` array.
 *
 * Searches for the first action type that represents a meaningful conversion result
 * (pixel lead, pixel purchase, complete registration, or link click).
 *
 * @param costPerActionType - The `cost_per_action_type` array from a Meta insights response.
 * @returns The cost per result as a float, or `null` if no matching action is found.
 */
export function getCostPerResult(
  costPerActionType?: Array<{ action_type: string; value: string }>
) {
  if (!costPerActionType) return null;
  const resultCost = costPerActionType.find(
    (a) =>
      a.action_type === 'offsite_conversion.fb_pixel_lead' ||
      a.action_type === 'lead' ||
      a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
      a.action_type === 'purchase' ||
      a.action_type === 'complete_registration' ||
      a.action_type === 'link_click'
  );

  return resultCost ? parseFloat(resultCost.value) : null;
}

/** Available date presets for Meta API insight queries, ordered from shortest to longest window. */
export const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last_7d' },
  { label: 'Last 14 Days', value: 'last_14d' },
  { label: 'Last 30 Days', value: 'last_30d' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
];

/** Supported call-to-action button types for Meta ad creatives. */
export const CALL_TO_ACTION_TYPES = [
  'APPLY_NOW',
  'BOOK_NOW',
  'BOOK_TRAVEL',
  'BUY_NOW',
  'CONTACT_US',
  'DOWNLOAD',
  'GET_OFFER',
  'GET_QUOTE',
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'SUBSCRIBE',
  'WATCH_MORE',
];
