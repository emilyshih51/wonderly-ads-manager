/**
 * Daily Metrics — the Motion-style grid: one row per day, each funnel metric shown as
 * ALL, a week-over-week % (that day vs the same weekday last week, i.e. 7 rows back),
 * then the FB and Organic channel split, with a 7d-average / MTD / Prev-Month summary
 * block on top.
 *
 * Every marketing event carries the session's utm_source / fbclid, so the funnel steps
 * (page views → CTA → partial → qualified → Call 1 booked) split into FB vs Organic
 * from page view on. Spend is 100% Facebook (FB = ALL, Organic = 0). CPC, Held and
 * Accepted have no channel split, so their FB/Organic cells stay blank. The column
 * shape mirrors Motion's so it's ready when more channels come online.
 *
 * The heat-map on the w/w columns is applied once in the sheet (conditional formatting
 * persists across the cron's value-only rewrites).
 *
 * Cron-computed and unit-tested. Written to the "Daily Metrics" tab.
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';

/**
 * A metric column-group. `daily` is the ALL day value; `fb`/`organic` are the optional
 * channel split (blank when a metric has no split). Ratio metrics (e.g. CPC) aggregate
 * windows as Σnumer ÷ Σdenom rather than a mean/sum.
 */
interface Metric {
  label: string;
  daily: (r: MarketingDailyRow) => number;
  fb?: (r: MarketingDailyRow) => number;
  organic?: (r: MarketingDailyRow) => number;
  numer?: (r: MarketingDailyRow) => number;
  denom?: (r: MarketingDailyRow) => number;
}

const METRICS: Metric[] = [
  // Spend is 100% Facebook — FB mirrors ALL, Organic is zero by definition.
  { label: 'Spend', daily: (r) => r.fbSpend, fb: (r) => r.fbSpend, organic: () => 0 },
  {
    label: 'CPC',
    daily: (r) => (r.fbClicks > 0 ? r.fbSpend / r.fbClicks : 0),
    numer: (r) => r.fbSpend,
    denom: (r) => r.fbClicks,
  },
  {
    label: 'Page views',
    daily: (r) => r.pageView,
    fb: (r) => r.pageViewFb,
    organic: (r) => r.pageViewOrganic,
  },
  { label: 'CTA', daily: (r) => r.ctaClicked, fb: (r) => r.ctaFb, organic: (r) => r.ctaOrganic },
  {
    label: 'Partial',
    daily: (r) => r.submitPartial,
    fb: (r) => r.submitPartialFb,
    organic: (r) => r.submitPartialOrganic,
  },
  {
    label: 'Qualified',
    daily: (r) => r.submitQualified,
    fb: (r) => r.submitQualifiedFb,
    organic: (r) => r.submitQualifiedOrganic,
  },
  {
    label: 'Call 1 booked',
    daily: (r) => r.bookedAll,
    fb: (r) => r.bookedFb,
    organic: (r) => r.bookedOrganic,
  },
  // Held / Accepted are CRM sales outcomes with no channel attribution yet — ALL only.
  { label: 'Held', daily: (r) => r.held },
  { label: 'Accepted', daily: (r) => r.accepted },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function sum(rows: MarketingDailyRow[], f: (r: MarketingDailyRow) => number): number {
  return rows.reduce((s, r) => s + f(r), 0);
}

/** Percent change, blank when there's no base to compare against. */
function pct(now: number, base: number): number | '' {
  return base > 0 ? round4((now - base) / base) : '';
}

/**
 * Window aggregate for a given accessor: ratios use Σnumer/Σdenom; additive metrics use
 * mean or sum.
 */
function agg(
  m: Metric,
  accessor: (r: MarketingDailyRow) => number,
  rows: MarketingDailyRow[],
  mode: 'mean' | 'sum'
): number {
  if (m.numer && m.denom) {
    const d = sum(rows, m.denom);

    return d > 0 ? round2(sum(rows, m.numer) / d) : 0;
  }

  const total = sum(rows, accessor);

  return round2(mode === 'mean' && rows.length > 0 ? total / rows.length : total);
}

/** `YYYY-MM` of the month before the given `YYYY-MM-DD`. */
function prevMonthKey(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));

  d.setUTCMonth(d.getUTCMonth() - 1);

  return d.toISOString().slice(0, 7);
}

/**
 * Build the Daily Metrics matrix.
 *
 * Layout: a group-header row (metric names), a sub-header row (Date + ALL/w-w/FB/Organic
 * per metric), the 7d-avg / MTD / Prev-Month summary rows, then daily rows newest-first.
 *
 * @param rows - Daily rows, newest first
 * @param today - Pacific `YYYY-MM-DD`, for the MTD / Prev-Month windows
 */
export function computeDailyMetrics(
  rows: MarketingDailyRow[],
  today: string
): (string | number)[][] {
  const currentMonth = today.slice(0, 7);
  const prevMonth = prevMonthKey(today);
  const dayOfMonth = today.slice(8, 10);

  const last7 = rows.slice(0, 7);
  const prev7 = rows.slice(7, 14);
  const mtd = rows.filter((r) => r.date.slice(0, 7) === currentMonth && r.date <= today);
  const prevMtd = rows.filter(
    (r) => r.date.slice(0, 7) === prevMonth && r.date.slice(8, 10) <= dayOfMonth
  );
  const prevMonthAll = rows.filter((r) => r.date.slice(0, 7) === prevMonth);

  // Row 1: metric names above each ALL/w-w/FB/Organic group. Row 2: sub-headers.
  const groupHeader: (string | number)[] = [''];
  const subHeader: (string | number)[] = ['Date'];

  for (const m of METRICS) {
    groupHeader.push(m.label, '', '', '');
    subHeader.push('ALL', 'w/w', 'FB', 'Organic');
  }

  const summaryRow = (
    label: string,
    windowRows: MarketingDailyRow[],
    baseRows: MarketingDailyRow[] | null,
    mode: 'mean' | 'sum'
  ): (string | number)[] => {
    const out: (string | number)[] = [label];

    for (const m of METRICS) {
      const now = agg(m, m.daily, windowRows, mode);

      out.push(
        now,
        baseRows ? pct(now, agg(m, m.daily, baseRows, mode)) : '',
        m.fb ? agg(m, m.fb, windowRows, mode) : '',
        m.organic ? agg(m, m.organic, windowRows, mode) : ''
      );
    }

    return out;
  };

  const matrix: (string | number)[][] = [
    groupHeader,
    subHeader,
    summaryRow('7d avg', last7, prev7, 'mean'),
    summaryRow('MTD', mtd, prevMtd, 'sum'),
    summaryRow('Prev Month', prevMonthAll, null, 'sum'),
  ];

  rows.forEach((r, i) => {
    const weekAgo = rows[i + 7];
    const out: (string | number)[] = [r.date];

    for (const m of METRICS) {
      out.push(
        round2(m.daily(r)),
        weekAgo ? pct(m.daily(r), m.daily(weekAgo)) : '',
        m.fb ? round2(m.fb(r)) : '',
        m.organic ? round2(m.organic(r)) : ''
      );
    }

    matrix.push(out);
  });

  return matrix;
}
