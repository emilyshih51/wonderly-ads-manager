/**
 * Daily Metrics — the Motion-style grid: one row per day, each funnel metric shown as
 * ALL, a week-over-week % (this-week average vs the previous 7 completed days), and the
 * source split FB / Google / Yahoo / Bing / N-A, with a 7d-average / MTD / Prev-Month
 * summary block on top written as live sheet formulas.
 *
 * Every marketing event carries the session's source, so the funnel steps (page views →
 * booking) and the held/accepted outcomes split five ways. Spend and CPC are Facebook-only
 * (FB mirrors ALL; the other channels stay blank). The heat-map on the w/w columns is
 * applied once in the sheet.
 *
 * Cron-computed and unit-tested. Written to the "Daily Metrics" tab.
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';

type Accessor = (r: MarketingDailyRow) => number;

/** A metric column-group: an ALL value, an optional ratio aggregation, and per-source accessors. */
interface Metric {
  label: string;
  daily: Accessor;
  /** Ratio metrics (CPC) aggregate windows as Σnumer ÷ Σdenom. */
  numer?: Accessor;
  denom?: Accessor;
  fb?: Accessor;
  google?: Accessor;
  yahoo?: Accessor;
  bing?: Accessor;
  na?: Accessor;
}

const cpc = (r: MarketingDailyRow): number => (r.fbClicks > 0 ? r.fbSpend / r.fbClicks : 0);

const METRICS: Metric[] = [
  // Spend and CPC are 100% Facebook — FB mirrors ALL, the other channels stay blank.
  { label: 'Spend', daily: (r) => r.fbSpend, fb: (r) => r.fbSpend },
  { label: 'CPC', daily: cpc, fb: cpc, numer: (r) => r.fbSpend, denom: (r) => r.fbClicks },
  {
    label: 'Page views',
    daily: (r) => r.pageView,
    fb: (r) => r.pageViewFb,
    google: (r) => r.pageViewGoogle,
    yahoo: (r) => r.pageViewYahoo,
    bing: (r) => r.pageViewBing,
    na: (r) => r.pageViewNa,
  },
  {
    label: 'CTA',
    daily: (r) => r.ctaClicked,
    fb: (r) => r.ctaFb,
    google: (r) => r.ctaGoogle,
    yahoo: (r) => r.ctaYahoo,
    bing: (r) => r.ctaBing,
    na: (r) => r.ctaNa,
  },
  {
    label: 'Partial',
    daily: (r) => r.submitPartial,
    fb: (r) => r.submitPartialFb,
    google: (r) => r.submitPartialGoogle,
    yahoo: (r) => r.submitPartialYahoo,
    bing: (r) => r.submitPartialBing,
    na: (r) => r.submitPartialNa,
  },
  {
    label: 'Qualified',
    daily: (r) => r.submitQualified,
    fb: (r) => r.submitQualifiedFb,
    google: (r) => r.submitQualifiedGoogle,
    yahoo: (r) => r.submitQualifiedYahoo,
    bing: (r) => r.submitQualifiedBing,
    na: (r) => r.submitQualifiedNa,
  },
  {
    label: 'Call 1 booked',
    daily: (r) => r.bookedAll,
    fb: (r) => r.bookedFb,
    google: (r) => r.bookedGoogle,
    yahoo: (r) => r.bookedYahoo,
    bing: (r) => r.bookedBing,
    na: (r) => r.bookedNa,
  },
  {
    label: 'Held',
    daily: (r) => r.held,
    fb: (r) => r.heldFb,
    google: (r) => r.heldGoogle,
    yahoo: (r) => r.heldYahoo,
    bing: (r) => r.heldBing,
    na: (r) => r.heldNa,
  },
  {
    label: 'Accepted',
    daily: (r) => r.accepted,
    fb: (r) => r.acceptedFb,
    google: (r) => r.acceptedGoogle,
    yahoo: (r) => r.acceptedYahoo,
    bing: (r) => r.acceptedBing,
    na: (r) => r.acceptedNa,
  },
];

/** Per-source columns in order (after ALL and w/w). */
const SOURCE_HEADERS = ['FB', 'Google', 'Yahoo', 'Bing', 'N/A'];

/** Columns per metric group: ALL, w/w, FB, Google, Yahoo, Bing, N/A. */
const COLS_PER_METRIC = 2 + SOURCE_HEADERS.length;

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

/** The per-source accessors of a metric, in column order (undefined = blank column). */
function sourceAccessors(m: Metric): (Accessor | undefined)[] {
  return [m.fb, m.google, m.yahoo, m.bing, m.na];
}

/**
 * Build the Daily Metrics matrix.
 *
 * The three summary rows are live Google Sheets formulas (=AVERAGE / =SUMIFS /
 * =AVERAGEIFS); the 7d average uses the last 7 *completed* days. Daily rows below are
 * plain values. Data starts at sheet row 6 (rows 1-2 headers, rows 3-5 summaries).
 *
 * @param rows - Daily rows, newest first
 * @param today - Pacific `YYYY-MM-DD`, for the completed-day skip and month windows
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
  const dataEnd = 5 + rows.length;

  // 7d average uses the last 7 completed days — skip today's partial row if it's on top.
  const firstComplete = 6 + (rows[0]?.date === today ? 1 : 0);
  const s7Start = firstComplete;
  const s7End = firstComplete + 6;
  const p7Start = firstComplete + 7;
  const p7End = firstComplete + 13;

  const groupHeader: (string | number)[] = [''];
  const subHeader: (string | number)[] = ['Date'];

  for (const m of METRICS) {
    groupHeader.push(m.label, ...Array(COLS_PER_METRIC - 1).fill(''));
    subHeader.push('ALL', 'w/w', ...SOURCE_HEADERS);
  }

  const dateRange = `$A$6:$A$${dataEnd}`;
  const sumifs = (L: string, y: number, mo: number, d1: number, d2: number) =>
    `SUMIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&DATE(${y},${mo},${d1}),${dateRange},"<="&DATE(${y},${mo},${d2}))`;
  const avgifs = (L: string, y: number, mo: number, d1: number, d2: number) =>
    `AVERAGEIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&DATE(${y},${mo},${d1}),${dateRange},"<="&DATE(${y},${mo},${d2}))`;

  const valueCells = (colIndex: number, present: boolean, ratio: boolean) => {
    if (!present) return { d7: '', mtd: '', prev: '' };

    const L = colLetter(colIndex);

    return {
      d7: `=IFERROR(AVERAGE(${L}${s7Start}:${L}${s7End}),0)`,
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
    const allC = 1 + g * COLS_PER_METRIC;
    const La = colLetter(allC);
    const ratio = Boolean(m.numer && m.denom);
    const sources = sourceAccessors(m);

    const all = valueCells(allC, true, ratio);
    const wow7 = `=IFERROR((${La}3-AVERAGE(${La}${p7Start}:${La}${p7End}))/AVERAGE(${La}${p7Start}:${La}${p7End}),"")`;
    const prevSpan = ratio
      ? avgifs(La, py, pm, 1, prevSpanEndDay)
      : sumifs(La, py, pm, 1, prevSpanEndDay);
    const wowMtd = `=IFERROR((${La}4-${prevSpan})/${prevSpan},"")`;

    const bucketCells = sources.map((acc, i) => valueCells(allC + 2 + i, Boolean(acc), ratio));

    d7Row.push(all.d7, wow7, ...bucketCells.map((b) => b.d7));
    mtdRow.push(all.mtd, wowMtd, ...bucketCells.map((b) => b.mtd));
    prevRow.push(all.prev, '', ...bucketCells.map((b) => b.prev));
  });

  const matrix: (string | number)[][] = [groupHeader, subHeader, d7Row, mtdRow, prevRow];

  rows.forEach((r, i) => {
    const weekAgo = rows[i + 7];
    const out: (string | number)[] = [r.date];

    for (const m of METRICS) {
      out.push(
        round2(m.daily(r)),
        weekAgo ? pct(m.daily(r), m.daily(weekAgo)) : '',
        ...sourceAccessors(m).map((acc) => (acc ? round2(acc(r)) : ''))
      );
    }

    matrix.push(out);
  });

  return matrix;
}
