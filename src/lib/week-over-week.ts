/**
 * Week-over-Week — the current 7 days vs the previous 7 days for every funnel step.
 *
 * One row per step, showing the count this week, last week, the absolute and percent
 * change, this week's conversion from the prior step, the cost per result, and how
 * that cost moved. Pure aggregation of `wonderly_daily` (daily counts + FB spend) —
 * no new data. Window rates use summed numerator ÷ summed denominator (not an average
 * of daily rates), and cost = summed spend ÷ summed count, so a heavy day is weighted
 * correctly. The cron writes this to the "Week over Week" tab.
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';

/** Column order for the Week over Week tab. */
export const WEEK_OVER_WEEK_HEADERS = [
  'STEP',
  'THIS_7D',
  'PREV_7D',
  'CHANGE',
  'PCT_CHANGE',
  'CONVERSION',
  'COST_PER_RESULT',
  'COST_PCT_CHANGE',
] as const;

interface FunnelStep {
  label: string;
  count: (r: MarketingDailyRow) => number;
  /** Prior step's count, for the conversion rate. Omitted for the top of the funnel. */
  prev?: (r: MarketingDailyRow) => number;
  /** FB_SPEND is the input, not an outcome — no conversion or cost-per. */
  isSpend?: boolean;
}

const STEPS: FunnelStep[] = [
  { label: 'FB_SPEND', count: (r) => r.fbSpend, isSpend: true },
  { label: 'VISITS', count: (r) => r.pageView },
  { label: 'CTA', count: (r) => r.ctaClicked, prev: (r) => r.pageView },
  { label: 'PARTIAL', count: (r) => r.submitPartial, prev: (r) => r.ctaClicked },
  { label: 'QUALIFIED', count: (r) => r.submitQualified, prev: (r) => r.submitPartial },
  { label: 'CALL1_BOOKED', count: (r) => r.bookedAll, prev: (r) => r.submitQualified },
  { label: 'HELD', count: (r) => r.held, prev: (r) => r.bookedAll },
  { label: 'ACCEPTED', count: (r) => r.accepted, prev: (r) => r.bookedAll },
];

function sum(rows: MarketingDailyRow[], f: (r: MarketingDailyRow) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

/** Div-by-zero-safe fraction, 4 dp (percent change or rate; format the cell as %). */
function frac(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0;
}

/** Round to cents. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build the week-over-week matrix in WEEK_OVER_WEEK_HEADERS order.
 *
 * Assumes `rows` are one-per-day, newest first (as written to `wonderly_daily`): the
 * first 7 are "this week", the next 7 are "previous week". HELD / ACCEPTED are the
 * booking-day cohort (same as Daily Metrics / Daily Funnel), so recent windows read low.
 *
 * @param rows - Daily rows, newest first
 */
export function computeWeekOverWeek(rows: MarketingDailyRow[]): (string | number)[][] {
  const thisWk = rows.slice(0, 7);
  const prevWk = rows.slice(7, 14);
  const spendThis = sum(thisWk, (r) => r.fbSpend);
  const spendPrev = sum(prevWk, (r) => r.fbSpend);

  return STEPS.map((step) => {
    const t = sum(thisWk, step.count);
    const p = sum(prevWk, step.count);
    const conversion = step.prev ? frac(t, sum(thisWk, step.prev)) : '';
    const costThis = step.isSpend || t === 0 ? 0 : spendThis / t;
    const costPrev = step.isSpend || p === 0 ? 0 : spendPrev / p;

    return [
      step.label,
      step.isSpend ? money(t) : t,
      step.isSpend ? money(p) : p,
      step.isSpend ? money(t - p) : t - p,
      frac(t - p, p),
      conversion,
      step.isSpend ? '' : money(costThis),
      step.isSpend ? '' : frac(costThis - costPrev, costPrev),
    ];
  });
}
