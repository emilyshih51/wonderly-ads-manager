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
 * Merge insight rows into entity objects by matching on the given ID field.
 * @param entities - An array of objects representing entities (e.g. ad sets, ads) with an `id` field.
 * @param insightRows - An array of insight objects containing metrics, each with an ID field matching the entities.
 * @param idField - The key in the insight rows that corresponds to the entity ID (e.g. "ad_id", "adset_id").
 * @returns A new array of entities, each augmented with an `insights` property containing the matching insight row or `null`.
 */
export function attachInsights<T extends { id: string }, R extends object>(
  entities: T[],
  insightRows: R[],
  idField: keyof R
): Array<T & { insights: R | null }> {
  const insightsMap = new Map<string, R>();

  for (const row of insightRows) {
    const id = String(row[idField]);

    if (id) insightsMap.set(id, row);
  }

  return entities.map((entity) => ({
    ...entity,
    insights: insightsMap.get(entity.id) ?? null,
  }));
}

/**
 * Safely extract a message string from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Available date presets for Meta API insight queries, ordered from shortest to longest window. */
export const DATE_PRESETS = [
  { labelKey: 'today', value: 'today' },
  { labelKey: 'yesterday', value: 'yesterday' },
  { labelKey: 'last7Days', value: 'last_7d' },
  { labelKey: 'last14Days', value: 'last_14d' },
  { labelKey: 'last30Days', value: 'last_30d' },
  { labelKey: 'thisMonth', value: 'this_month' },
  { labelKey: 'lastMonth', value: 'last_month' },
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
