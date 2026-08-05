/**
 * Daily Metrics — the Motion-style grid: one row per day, each funnel metric shown as
 * ALL, a week-over-week % (that day vs the same weekday last week, i.e. 7 rows back),
 * with the FB and Organic channel split, and a leading Cost column (FB spend ÷ that
 * stage's ALL count) on each funnel stage. Spend/CPC have no Cost column. Summary rows
 * (7d-avg / MTD / Prev-Month) are live sheet formulas; Cost uses ratio-of-totals.
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
  /** Add a "Cost" column = FB spend ÷ this stage's count (cost per action), before ALL. */
  hasCost?: boolean;
  /** Drop the week-over-week column — for tiny-count metrics where w/w is just noise. */
  noWow?: boolean;
}

// Reversed-funnel order: the outcome reads first (leftmost) and the inputs (CPC, Spend) sit
// last, so the metrics that matter most are visible without scrolling right. Sequence is the
// funnel walked backwards: Accepted → Held → No show → Call 1 booked → … → Page views → CPC → Spend.
const METRICS: Metric[] = [
  // Accepted is the headline outcome, so it leads. Split by the deal's Call 1 source
  // (organic = ALL − FB).
  {
    label: 'Accepted',
    daily: (r) => r.accepted,
    fb: (r) => r.acceptedFb,
    organic: (r) => r.acceptedOrganic,
    hasCost: true,
    // Accepted runs 0–5 a day, so a day-vs-last-week % is just −100%/+400% noise. Drop it.
    noWow: true,
  },
  // Held split by the deal's Call 1 source (organic = ALL − FB).
  {
    label: 'Held',
    daily: (r) => r.held,
    fb: (r) => r.heldFb,
    organic: (r) => r.heldOrganic,
    hasCost: true,
  },
  // No show = booked calls now in "Call Missed Several Times", split by the deal's Call 1
  // source. Small daily counts, so (like Accepted) it drops the noisy w/w and has no Cost.
  {
    label: 'No show',
    daily: (r) => r.noShow,
    fb: (r) => r.noShowFb,
    organic: (r) => r.noShowOrganic,
    noWow: true,
  },
  {
    label: 'Call 1 booked',
    daily: (r) => r.bookedAll,
    fb: (r) => r.bookedFb,
    organic: (r) => r.bookedOrganic,
    hasCost: true,
  },
  {
    label: 'Qualified',
    daily: (r) => r.submitQualified,
    fb: (r) => r.submitQualifiedFb,
    organic: (r) => r.submitQualifiedOrganic,
    hasCost: true,
  },
  {
    label: 'Partial',
    daily: (r) => r.submitPartial,
    fb: (r) => r.submitPartialFb,
    organic: (r) => r.submitPartialOrganic,
    hasCost: true,
  },
  {
    label: 'CTA',
    daily: (r) => r.ctaClicked,
    fb: (r) => r.ctaFb,
    organic: (r) => r.ctaOrganic,
    hasCost: true,
  },
  {
    label: 'Page views',
    daily: (r) => r.pageView,
    fb: (r) => r.pageViewFb,
    organic: (r) => r.pageViewOrganic,
    hasCost: true,
  },
  {
    // 100% of spend and clicks are Facebook, so CPC's FB mirrors ALL; there is no
    // organic ad spend to divide, so Organic stays blank (no accessor) rather than 0.
    label: 'CPC',
    daily: (r) => (r.fbClicks > 0 ? r.fbSpend / r.fbClicks : 0),
    fb: (r) => (r.fbClicks > 0 ? r.fbSpend / r.fbClicks : 0),
    numer: (r) => r.fbSpend,
    denom: (r) => r.fbClicks,
  },
  // Spend is 100% Facebook — FB mirrors ALL, Organic is zero by definition.
  { label: 'Spend', daily: (r) => r.fbSpend, fb: (r) => r.fbSpend, organic: () => 0 },
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

/** Monday (UTC) of a date's week, as a stable weekly key. */
function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;

  d.setUTCDate(d.getUTCDate() - daysSinceMonday);

  return d.toISOString().slice(0, 10);
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
 * One weekly summary row: sums for counts/spend, ratio-of-totals for CPC/cost (Σnumer ÷
 * Σdenom), and a blank w/w cell (a week-total w/w would mix meanings with the daily
 * same-weekday w/w in that column). Labelled "Week of <Monday>" so the formatter can spot
 * it and the date-criteria SUMIFS in the summary rows skip it (its column A is text).
 */
function weeklyRow(members: MarketingDailyRow[]): (string | number)[] {
  const weekSpend = members.reduce((s, r) => s + r.fbSpend, 0);
  const out: (string | number)[] = [`Week of ${weekKey(members[0].date)}`];

  for (const m of METRICS) {
    const ratio = Boolean(m.numer && m.denom);
    const allCount = members.reduce((s, r) => s + m.daily(r), 0);

    let allV: number | '';
    let fbV: number | '';
    let orgV: number | '';

    if (ratio) {
      const numerFn = m.numer!;
      const denomFn = m.denom!;
      const denom = members.reduce((s, r) => s + denomFn(r), 0);

      allV = denom > 0 ? round2(members.reduce((s, r) => s + numerFn(r), 0) / denom) : 0;
      fbV = allV; // FB mirrors ALL — 100% of spend/clicks are Facebook
      orgV = ''; // no organic ad spend to divide
    } else {
      const fbFn = m.fb;
      const orgFn = m.organic;

      allV = round2(allCount);
      fbV = fbFn ? round2(members.reduce((s, r) => s + fbFn(r), 0)) : '';
      orgV = orgFn ? round2(members.reduce((s, r) => s + orgFn(r), 0)) : '';
    }

    if (m.hasCost) out.push(allCount > 0 ? round2(weekSpend / allCount) : '');
    out.push(allV);
    if (!m.noWow) out.push('');
    out.push(fbV, orgV);
  }

  return out;
}

/**
 * Build the Daily Metrics matrix.
 *
 * Layout: a group-header row (metric names), a sub-header row (Date + ALL/w-w/FB/Organic
 * per metric), the 7d-avg / MTD / Prev-Month summary rows, then daily rows newest-first —
 * grouped into ISO-week blocks with a "Week of …" summary row at the bottom of each block.
 *
 * The three summary rows are written as live Google Sheets FORMULAS (=AVERAGE / =SUMIFS /
 * =AVERAGEIFS) rather than pre-computed values, so the math stays visible and editable in
 * the sheet. The cron re-writes them verbatim each run, so they persist. Daily rows below
 * are plain values. Data starts at sheet row 6 (rows 1-2 headers, rows 3-5 summaries).
 *
 * @param rows - Daily rows, newest first
 * @param today - Pacific `YYYY-MM-DD`, used only to skip today's partial row from the
 *   7d average. The MTD / Prev-Month windows are live EOMONTH(TODAY()) sheet expressions.
 */
export function computeDailyMetrics(
  rows: MarketingDailyRow[],
  today: string
): (string | number)[][] {
  // Emission plan: daily rows (newest first) grouped into ISO-week blocks, each block
  // followed by a weekly summary row. Building the plan first lets us assign an exact sheet
  // row number to every daily row, so the 7d formulas below can list them explicitly and
  // stay correct even though weekly rows are interleaved among them.
  type PlanItem =
    | { kind: 'day'; row: MarketingDailyRow; i: number }
    | { kind: 'week'; members: MarketingDailyRow[] };
  const plan: PlanItem[] = [];
  let members: MarketingDailyRow[] = [];

  rows.forEach((r, i) => {
    plan.push({ kind: 'day', row: r, i });
    members.push(r);

    if (i === rows.length - 1 || weekKey(rows[i + 1].date) !== weekKey(r.date)) {
      plan.push({ kind: 'week', members });
      members = [];
    }
  });

  // Assign sheet row numbers (data starts at row 6) and record each daily row's number.
  let sheetRow = 6;
  const dailyRowNums: number[] = [];

  for (const item of plan) {
    if (item.kind === 'day') dailyRowNums.push(sheetRow);
    sheetRow += 1;
  }

  const dataEnd = sheetRow - 1; // last row of the block (daily rows + weekly summaries)

  // Month windows as live sheet expressions (EOMONTH/TODAY) rather than baked-in dates,
  // so MTD / Prev-Month advance on their own as the calendar rolls over — not only when
  // the cron reruns. EOMONTH(TODAY(),-1)+1 = the 1st of this month; last month is
  // EOMONTH(TODAY(),-2)+1 .. EOMONTH(TODAY(),-1).
  const mtdLo = '(EOMONTH(TODAY(),-1)+1)';
  const mtdHi = 'TODAY()';
  const prevLo = '(EOMONTH(TODAY(),-2)+1)';
  const prevHi = 'EOMONTH(TODAY(),-1)';
  // MTD w/w compares last month through the same day-of-month as today (capped at its end).
  const prevSpanHi = 'MIN(EOMONTH(TODAY(),-2)+DAY(TODAY()),EOMONTH(TODAY(),-1))';

  // The 7d average uses the last 7 *completed* daily rows (skip today's partial if it's at
  // the top). Explicit row numbers, since weekly summary rows sit between the daily rows.
  const completedRows = dailyRowNums.slice(rows[0]?.date === today ? 1 : 0);
  const s7 = completedRows.slice(0, 7);
  const p7 = completedRows.slice(7, 14);
  const cellList = (L: string, nums: number[]) => nums.map((n) => `${L}${n}`).join(',');

  // Per-metric column layout. Funnel stages prepend a Cost column, so groups are variable
  // width: Spend/CPC are [ALL, w/w, FB, Organic]; stages are [Cost, ALL, w/w, FB, Organic].
  let colIdx = 1;
  const layout = METRICS.map((m) => {
    const cost = m.hasCost ? colIdx++ : undefined;
    const all = colIdx++;
    const wow = m.noWow ? undefined : colIdx++;
    const fb = colIdx++;
    const organic = colIdx++;

    return { cost, all, wow, fb, organic };
  });
  // Cost-per-action's numerator is FB spend — the Spend metric's ALL column, wherever it
  // sits in the column order.
  const spendIdx = METRICS.findIndex((m) => m.label === 'Spend');
  const spendAll = colLetter(layout[spendIdx].all);

  const groupHeader: (string | number)[] = [''];
  const subHeader: (string | number)[] = ['Date'];

  for (const m of METRICS) {
    const cols: string[] = [];

    if (m.hasCost) cols.push('Cost');
    cols.push('ALL');
    if (!m.noWow) cols.push('w/w');
    cols.push('FB', 'Organic');

    groupHeader.push(m.label, ...Array(cols.length - 1).fill(''));
    subHeader.push(...cols);
  }

  // Summary-row formulas reference the daily block, sheet rows 6..dataEnd.
  const dateRange = `$A$6:$A$${dataEnd}`;
  const sumifs = (L: string, lo: string, hi: string) =>
    `SUMIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&${lo},${dateRange},"<="&${hi})`;
  const avgifs = (L: string, lo: string, hi: string) =>
    `AVERAGEIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&${lo},${dateRange},"<="&${hi})`;

  /** 7d-average / MTD / Prev-Month value formulas for one column (blank if not present). */
  const valueCells = (colIndex: number, present: boolean, ratio: boolean) => {
    if (!present) return { d7: '', mtd: '', prev: '' };

    const L = colLetter(colIndex);

    return {
      d7: s7.length ? `=IFERROR(AVERAGE(${cellList(L, s7)}),0)` : 0,
      mtd: ratio ? `=IFERROR(${avgifs(L, mtdLo, mtdHi)},0)` : `=${sumifs(L, mtdLo, mtdHi)}`,
      prev: ratio ? `=IFERROR(${avgifs(L, prevLo, prevHi)},0)` : `=${sumifs(L, prevLo, prevHi)}`,
    };
  };

  /**
   * Cost per action = ratio of totals: Σ FB spend ÷ Σ (ALL) stage count over the window.
   * The denominator is the stage's ALL count (FB + organic) — downstream stages are only
   * weakly channel-attributed, so ALL is the stable, gap-free denominator.
   */
  const costCells = (stageAll: string) => ({
    d7: s7.length ? `=IFERROR(SUM(${cellList(spendAll, s7)})/SUM(${cellList(stageAll, s7)}),0)` : 0,
    mtd: `=IFERROR(${sumifs(spendAll, mtdLo, mtdHi)}/${sumifs(stageAll, mtdLo, mtdHi)},0)`,
    prev: `=IFERROR(${sumifs(spendAll, prevLo, prevHi)}/${sumifs(stageAll, prevLo, prevHi)},0)`,
  });

  const d7Row: (string | number)[] = ['7d avg'];
  const mtdRow: (string | number)[] = ['MTD'];
  const prevRow: (string | number)[] = ['Prev Month'];

  METRICS.forEach((m, g) => {
    const L = layout[g];
    const La = colLetter(L.all);
    const ratio = Boolean(m.numer && m.denom);

    const all = valueCells(L.all, true, ratio);
    const fb = valueCells(L.fb, Boolean(m.fb), ratio);
    const organic = valueCells(L.organic, Boolean(m.organic), ratio);

    // 7d w/w: this-week average vs the previous 7 completed days.
    const p7avg = `AVERAGE(${cellList(La, p7)})`;
    const wow7 = p7.length ? `=IFERROR((${La}3-${p7avg})/${p7avg},"")` : '';
    // MTD w/w: month-to-date vs the same day-span of the previous month.
    const prevSpan = ratio ? avgifs(La, prevLo, prevSpanHi) : sumifs(La, prevLo, prevSpanHi);
    const wowMtd = `=IFERROR((${La}4-${prevSpan})/${prevSpan},"")`;

    if (m.hasCost) {
      const cost = costCells(La);

      d7Row.push(cost.d7);
      mtdRow.push(cost.mtd);
      prevRow.push(cost.prev);
    }

    d7Row.push(all.d7);
    mtdRow.push(all.mtd);
    prevRow.push(all.prev);

    if (!m.noWow) {
      d7Row.push(wow7);
      mtdRow.push(wowMtd);
      prevRow.push('');
    }

    d7Row.push(fb.d7, organic.d7);
    mtdRow.push(fb.mtd, organic.mtd);
    prevRow.push(fb.prev, organic.prev);
  });

  const matrix: (string | number)[][] = [groupHeader, subHeader, d7Row, mtdRow, prevRow];

  for (const item of plan) {
    if (item.kind === 'week') {
      matrix.push(weeklyRow(item.members));
      continue;
    }

    const { row: r, i } = item;
    const weekAgo = rows[i + 7];
    const out: (string | number)[] = [r.date];

    for (const m of METRICS) {
      const count = m.daily(r);
      const allV = round2(count);
      const wowV = weekAgo ? pct(count, m.daily(weekAgo)) : '';
      const fbV = m.fb ? round2(m.fb(r)) : '';
      const orgV = m.organic ? round2(m.organic(r)) : '';

      if (m.hasCost) {
        // Daily cost = that day's FB spend ÷ that day's ALL (FB + organic) count of the
        // stage (blank on zero-action days).
        const costV = count > 0 ? round2(r.fbSpend / count) : '';

        out.push(costV);
      }

      out.push(allV);
      if (!m.noWow) out.push(wowV);
      out.push(fbV, orgV);
    }

    matrix.push(out);
  }

  return matrix;
}
