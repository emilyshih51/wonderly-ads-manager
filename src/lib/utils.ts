import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return `${num.toFixed(2)}%`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-';
  return new Intl.NumberFormat('en-US').format(num);
}

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

export const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last_7d' },
  { label: 'Last 14 Days', value: 'last_14d' },
  { label: 'Last 30 Days', value: 'last_30d' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
];

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
