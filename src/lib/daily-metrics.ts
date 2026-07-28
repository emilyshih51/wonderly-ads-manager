/**
 * Daily Metrics — the Motion-style grid: one row per day, each funnel metric shown as
 * ALL, a week-over-week % (that day vs the same weekday last week, i.e. 7 rows back),
 * then the FB and Organic channel split, with a 7d-average / MTD / Prev-Month summary
 * block on top written as live sheet formulas.
 *
 * Every marketing event carries the session's utm_source / fbclid, so the funnel steps
 * (page views → CTA → partial → qualified → Call 1 booked) split into FB vs Organic
 * from page view on. Held and Accepted split too, by the deal's Call 1 source. Spend is
 * 100% Facebook (FB = ALL, Organic = 0). Only CPC has no split, so its FB/Organic cells
 * stay blank. The column shape mirrors Motion's so it's ready for more channels.
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
    // 100% of spend and clicks are Facebook, so CPC's FB mirrors ALL; there is no
    // organic ad spend to divide, so Organic stays blank (no accessor) rather than 0.
    label: 'CPC',
    daily: (r) => (r.fbClicks > 0 ? r.fbSpend / r.fbClicks : 0),
    fb: (r) => (r.fbClicks > 0 ? r.fbSpend / r.fbClicks : 0),
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
  // Held / Accepted split by the deal's Call 1 source (organic = ALL − FB).
  { label: 'Held', daily: (r) => r.held, fb: (r) => r.heldFb, organic: (r) => r.heldOrganic },
  {
    label: 'Accepted',
    daily: (r) => r.accepted,
    fb: (r) => r.acceptedFb,
    organic: (r) => r.acceptedOrganic,
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Percent change, blank when there's no base to compare against. */
function pct(now: number, base: number): number | '' {
  return base > 0 ? round4((now - base) / base) : '';
}

/** 0-based column index to an A1 column letter (0 → A, 26 → AA). */
function colLetter(index: number): string {
  let s = '';
  let i = index + 1;

  while (i > 0) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    i = Math.floor((i - 1) / 26);
  }

  return s;
}

/**
 * Build the Daily Metrics matrix.
 *
 * Layout: a group-header row (metric names), a sub-header row (Date + ALL/w-w/FB/Organic
 * per metric), the 7d-avg / MTD / Prev-Month summary rows, then daily rows newest-first.
 *
 * The three summary rows are written as live Google Sheets FORMULAS (=AVERAGE / =SUMIFS /
 * =AVERAGEIFS) rather than pre-computed values, so the math stays visible and editable in
 * the sheet. The cron re-writes them verbatim each run, so they persist. Daily rows below
 * are plain values. Data starts at sheet row 6 (rows 1-2 headers, rows 3-5 summaries).
 *
 * @param rows - Daily rows, newest first
 * @param today - Pacific `YYYY-MM-DD`, for the MTD / Prev-Month windows
 */
export function computeDailyMetrics(
  rows: MarketingDailyRow[],
  today: string
): (string | number)[][] {
  const [ty, tm, td] = today.split('-').map(Number);
  const pm = tm === 1 ? 12 : tm - 1;
  const py = tm === 1 ? ty - 1 : ty;
  const prevMonthLastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const prevSpanEndDay = Math.min(td, prevMonthLastDay);
  const dataEnd = 5 + rows.length; // last daily row (data starts at sheet row 6)

  // Row 1: metric names above each ALL/w-w/FB/Organic group. Row 2: sub-headers.
  const groupHeader: (string | number)[] = [''];
  const subHeader: (string | number)[] = ['Date'];

  for (const m of METRICS) {
    groupHeader.push(m.label, '', '', '');
    subHeader.push('ALL', 'w/w', 'FB', 'Organic');
  }

  // Summary-row formulas reference the daily block, sheet rows 6..dataEnd.
  const dateRange = `$A$6:$A$${dataEnd}`;
  const sumifs = (L: string, y: number, mo: number, d1: number, d2: number) =>
    `SUMIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&DATE(${y},${mo},${d1}),${dateRange},"<="&DATE(${y},${mo},${d2}))`;
  const avgifs = (L: string, y: number, mo: number, d1: number, d2: number) =>
    `AVERAGEIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&DATE(${y},${mo},${d1}),${dateRange},"<="&DATE(${y},${mo},${d2}))`;

  /** 7d-average / MTD / Prev-Month value formulas for one column (blank if not present). */
  const valueCells = (colIndex: number, present: boolean, ratio: boolean) => {
    if (!present) return { d7: '', mtd: '', prev: '' };

    const L = colLetter(colIndex);

    return {
      d7: `=IFERROR(AVERAGE(${L}6:${L}12),0)`,
      mtd: ratio ? `=IFERROR(${avgifs(L, ty, tm, 1, td)},0)` : `=${sumifs(L, ty, tm, 1, td)}`,
      prev: ratio
        ? `=IFERROR(${avgifs(L, py, pm, 1, prevMonthLastDay)},0)`
        : `=${sumifs(L, py, pm, 1, prevMonthLastDay)}`,
    };
  };

  const d7Row: (string | number)[] = ['7d avg'];
  const mtdRow: (string | number)[] = ['MTD'];
  const prevRow: (string | number)[] = ['Prev Month'];

  METRICS.forEach((m, g) => {
    const allC = 1 + g * 4;
    const La = colLetter(allC);
    const ratio = Boolean(m.numer && m.denom);

    const all = valueCells(allC, true, ratio);
    const fb = valueCells(allC + 2, Boolean(m.fb), ratio);
    const organic = valueCells(allC + 3, Boolean(m.organic), ratio);

    // 7d w/w: this-week average vs the previous 7 days (rows 13-19).
    const wow7 = `=IFERROR((${La}3-AVERAGE(${La}13:${La}19))/AVERAGE(${La}13:${La}19),"")`;
    // MTD w/w: month-to-date vs the same day-span of the previous month.
    const prevSpan = ratio
      ? avgifs(La, py, pm, 1, prevSpanEndDay)
      : sumifs(La, py, pm, 1, prevSpanEndDay);
    const wowMtd = `=IFERROR((${La}4-${prevSpan})/${prevSpan},"")`;

    d7Row.push(all.d7, wow7, fb.d7, organic.d7);
    mtdRow.push(all.mtd, wowMtd, fb.mtd, organic.mtd);
    prevRow.push(all.prev, '', fb.prev, organic.prev);
  });

  const matrix: (string | number)[][] = [groupHeader, subHeader, d7Row, mtdRow, prevRow];

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
