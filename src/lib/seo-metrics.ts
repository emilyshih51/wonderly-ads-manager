/**
 * SEO Metrics — the Motion-style grid for organic search, mirroring the Daily Metrics tab.
 *
 * Same layout, same cadence, same reading habits: one row per day newest-first, grouped
 * into ISO-week blocks with a "Week of …" summary row closing each block, under live
 * 7d-avg / MTD / Prev-Month formula rows. Metrics run the funnel backwards so the outcome
 * reads first: Accepted → Held → No show → Call 1 booked → Qualified → Partial → CTA →
 * Sessions.
 *
 * Where Daily Metrics puts a **Cost** column in front of each stage, this tab puts
 * **Conv** — the step conversion from the previous stage. That substitution is the whole
 * point: SEO has no media spend to divide by, so the efficiency question isn't "what did
 * this cost" but "what share of the previous step made it here". Everything else lines up:
 *
 *   Daily Metrics:  [Cost]  ALL   [w/w]  FB   Organic
 *   SEO Metrics:    [Conv]  SEO   [w/w]  ALL  SEO share
 *
 * SEO is the primary column (leftmost in each group) because this tab is read by whoever
 * owns organic; ALL and SEO-share sit to its right so the channel can always be seen in
 * proportion to the whole site without opening another tab.
 *
 * Windowed aggregates use RATIO OF TOTALS, never a mean of daily rates — a day with 3
 * sessions must not weigh the same as a day with 300. That applies to Conv and SEO share
 * in the weekly rows and in all three summary rows.
 *
 * Maturation caveat inherited from the rest of the sheet: Held / No show / Accepted are
 * cohort metrics keyed to the deal's booking day, so the newest rows read low until those
 * deals work through the pipeline. Read the weekly rows, not the last daily row.
 *
 * Cron-computed and unit-tested. Written to the "SEO Metrics" tab.
 */

import type { Channel, ChannelFunnelRow } from '@/lib/channel';

/** The funnel counts this tab reports, per day, for one slice (SEO or all channels). */
export interface SeoCounts {
  sessions: number;
  cta: number;
  submitPartial: number;
  submitQualified: number;
  booked: number;
  held: number;
  noShow: number;
  accepted: number;
}

const ZERO: SeoCounts = {
  sessions: 0,
  cta: 0,
  submitPartial: 0,
  submitQualified: 0,
  booked: 0,
  held: 0,
  noShow: 0,
  accepted: 0,
};

/** One day, split into the organic-search slice and the all-channels total. */
export interface SeoDay {
  date: string;
  seo: SeoCounts;
  all: SeoCounts;
}

/**
 * A metric column-group. `value` reads the count from a slice; `prev` names the previous
 * funnel step, which supplies the Conv denominator (absent = no Conv column).
 */
interface SeoMetric {
  label: string;
  value: (c: SeoCounts) => number;
  /**
   * Label of the previous funnel step. Conv = this stage ÷ that stage, within the SEO
   * slice. Referencing the step BY LABEL rather than by its own accessor keeps one
   * definition of each stage's count — and makes the denominator's column findable in the
   * summary-row formulas, which need the sheet column, not just the number.
   */
  prevLabel?: string;
  /** Drop the week-over-week column — for tiny-count metrics where w/w is only noise. */
  noWow?: boolean;
}

/**
 * Reversed-funnel order, matching Daily Metrics so the two tabs read the same way.
 *
 * Accepted and No show drop their w/w for the same reason they do there: organic runs 0–2
 * accepted on a good day, so a day-vs-same-weekday percentage is −100%/+200% noise. The
 * weekly rows are where those two are actually legible.
 */
const METRICS: SeoMetric[] = [
  { label: 'Accepted', value: (c) => c.accepted, prevLabel: 'Call 1 booked', noWow: true },
  { label: 'Held', value: (c) => c.held, prevLabel: 'Call 1 booked' },
  // A disposition of a booked call, not a funnel step — it converts against nothing.
  { label: 'No show', value: (c) => c.noShow, noWow: true },
  { label: 'Call 1 booked', value: (c) => c.booked, prevLabel: 'Qualified' },
  { label: 'Qualified', value: (c) => c.submitQualified, prevLabel: 'Partial' },
  { label: 'Partial', value: (c) => c.submitPartial, prevLabel: 'CTA' },
  { label: 'CTA', value: (c) => c.cta, prevLabel: 'Sessions' },
  // Top of funnel — nothing precedes it, so no Conv column.
  { label: 'Sessions', value: (c) => c.sessions },
];

/** Index of a metric by label. Throws on a typo'd `prevLabel` rather than silently skipping. */
function metricIndex(label: string): number {
  const i = METRICS.findIndex((m) => m.label === label);

  if (i === -1) throw new Error(`SEO metric "${label}" is not defined`);

  return i;
}

/** Metric labels in column order — the formatter must stay in step with this. */
export const SEO_METRICS_LABELS = METRICS.map((m) => ({
  label: m.label,
  hasConv: Boolean(m.prevLabel),
  noWow: Boolean(m.noWow),
}));

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

/** Ratio, blank (not zero) when the denominator is zero — an unknown rate isn't 0%. */
function ratio(numerator: number, denominator: number): number | '' {
  return denominator > 0 ? round4(numerator / denominator) : '';
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

function addCounts(a: SeoCounts, b: SeoCounts): SeoCounts {
  return {
    sessions: a.sessions + b.sessions,
    cta: a.cta + b.cta,
    submitPartial: a.submitPartial + b.submitPartial,
    submitQualified: a.submitQualified + b.submitQualified,
    booked: a.booked + b.booked,
    held: a.held + b.held,
    noShow: a.noShow + b.noShow,
    accepted: a.accepted + b.accepted,
  };
}

/**
 * Collapse the long (day, channel) rows into one entry per day: the `seo` slice and the
 * `all` total across every channel.
 *
 * @param rows - Long-format rows from `SnowflakeService.getChannelFunnel`
 * @param minDate - Floor date (`YYYY-MM-DD`); older rows are dropped
 * @returns One entry per day with any activity, newest day first
 */
export function toSeoDays(rows: ChannelFunnelRow[], minDate: string): SeoDay[] {
  const byDate = new Map<string, { seo: SeoCounts; all: SeoCounts }>();

  for (const r of rows) {
    if (r.date < minDate) continue;

    const day = byDate.get(r.date) ?? { seo: { ...ZERO }, all: { ...ZERO } };
    const counts: SeoCounts = {
      sessions: r.sessions,
      cta: r.cta,
      submitPartial: r.submitPartial,
      submitQualified: r.submitQualified,
      booked: r.booked,
      held: r.held,
      noShow: r.noShow,
      accepted: r.accepted,
    };

    day.all = addCounts(day.all, counts);
    if ((r.channel as Channel) === 'seo') day.seo = addCounts(day.seo, counts);
    byDate.set(r.date, day);
  }

  return [...byDate.entries()]
    .map(([date, v]) => ({ date, seo: v.seo, all: v.all }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * One weekly summary row: sums for the counts, ratio-of-totals for Conv and SEO share, and
 * a blank w/w cell (a week-total w/w would mix meanings with the same-weekday w/w that
 * column carries on daily rows).
 *
 * Labelled "Week of <Monday>" so the formatter can find it and so the date-criteria SUMIFS
 * in the summary rows skip it — its column A is text, not a date.
 */
function weeklyRow(members: SeoDay[]): (string | number)[] {
  const seo = members.map((m) => m.seo).reduce(addCounts, { ...ZERO });
  const all = members.map((m) => m.all).reduce(addCounts, { ...ZERO });
  const out: (string | number)[] = [`Week of ${weekKey(members[members.length - 1].date)}`];

  for (const m of METRICS) {
    if (m.prevLabel) out.push(ratio(m.value(seo), METRICS[metricIndex(m.prevLabel)].value(seo)));
    out.push(m.value(seo));
    if (!m.noWow) out.push('');
    out.push(m.value(all), ratio(m.value(seo), m.value(all)));
  }

  return out;
}

/**
 * Build the SEO Metrics matrix.
 *
 * Layout mirrors Daily Metrics exactly: a merged group-header row, a sub-header row
 * (Date + Conv/SEO/w-w/ALL/SEO share per metric), the 7d-avg / MTD / Prev-Month rows, then
 * daily rows newest-first in ISO-week blocks each closed by a weekly summary row.
 *
 * The three summary rows are written as live Google Sheets FORMULAS (=AVERAGE / =SUMIFS)
 * rather than pre-computed values, so the math stays visible and editable in the sheet and
 * the month windows self-advance via EOMONTH(TODAY()) instead of baking in dates. The cron
 * rewrites them verbatim each run. Data starts at sheet row 6.
 *
 * @param rows - Long-format rows from `getChannelFunnel`
 * @param today - Pacific `YYYY-MM-DD`, used only to skip today's partial row from the 7d average
 * @param minDate - Floor date (`YYYY-MM-DD`), normally the backfill anchor
 */
export function computeSeoMetrics(
  rows: ChannelFunnelRow[],
  today: string,
  minDate: string
): (string | number)[][] {
  const days = toSeoDays(rows, minDate);

  // Emission plan first: daily rows grouped into ISO-week blocks, each closed by a weekly
  // row. Building it up front lets every daily row get an exact sheet row number, so the 7d
  // formulas can list those rows explicitly and stay correct despite the interleaved
  // weekly rows.
  type PlanItem = { kind: 'day'; day: SeoDay; i: number } | { kind: 'week'; members: SeoDay[] };
  const plan: PlanItem[] = [];
  let members: SeoDay[] = [];

  days.forEach((d, i) => {
    plan.push({ kind: 'day', day: d, i });
    members.push(d);

    if (i === days.length - 1 || weekKey(days[i + 1].date) !== weekKey(d.date)) {
      plan.push({ kind: 'week', members });
      members = [];
    }
  });

  let sheetRow = 6;
  const dailyRowNums: number[] = [];

  for (const item of plan) {
    if (item.kind === 'day') dailyRowNums.push(sheetRow);
    sheetRow += 1;
  }

  const dataEnd = sheetRow - 1;

  // Month windows as live sheet expressions so MTD / Prev Month roll over on their own.
  const mtdLo = '(EOMONTH(TODAY(),-1)+1)';
  const mtdHi = 'TODAY()';
  const prevLo = '(EOMONTH(TODAY(),-2)+1)';
  const prevHi = 'EOMONTH(TODAY(),-1)';
  // MTD w/w compares last month through the same day-of-month as today (capped at its end).
  const prevSpanHi = 'MIN(EOMONTH(TODAY(),-2)+DAY(TODAY()),EOMONTH(TODAY(),-1))';

  // 7d average uses the last 7 *completed* daily rows (skip today's partial if it leads).
  const completedRows = dailyRowNums.slice(days[0]?.date === today ? 1 : 0);
  const s7 = completedRows.slice(0, 7);
  const p7 = completedRows.slice(7, 14);
  const cellList = (L: string, nums: number[]) => nums.map((n) => `${L}${n}`).join(',');

  // Per-metric column layout. Groups are variable width: a Conv column is prepended on
  // every stage that has a previous step, and `noWow` metrics drop their w/w column.
  let colIdx = 1;
  const layout = METRICS.map((m) => {
    const conv = m.prevLabel ? colIdx++ : undefined;
    const seo = colIdx++;
    const wow = m.noWow ? undefined : colIdx++;
    const all = colIdx++;
    const share = colIdx++;

    return { conv, seo, wow, all, share };
  });

  const groupHeader: (string | number)[] = [''];
  const subHeader: (string | number)[] = ['Date'];

  METRICS.forEach((m) => {
    const cols: string[] = [];

    if (m.prevLabel) cols.push('Conv');
    cols.push('SEO');
    if (!m.noWow) cols.push('w/w');
    cols.push('ALL', 'SEO %');

    groupHeader.push(m.label, ...Array(cols.length - 1).fill(''));
    subHeader.push(...cols);
  });

  const dateRange = `$A$6:$A$${dataEnd}`;
  const sumifs = (L: string, lo: string, hi: string) =>
    `SUMIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&${lo},${dateRange},"<="&${hi})`;

  /** 7d-average / MTD / Prev-Month for a plain count column. */
  const countCells = (colIndex: number) => {
    const L = colLetter(colIndex);

    return {
      d7: s7.length ? `=IFERROR(AVERAGE(${cellList(L, s7)}),0)` : 0,
      mtd: `=${sumifs(L, mtdLo, mtdHi)}`,
      prev: `=${sumifs(L, prevLo, prevHi)}`,
    };
  };

  /**
   * A rate over a window = ratio of totals (Σ numerator ÷ Σ denominator), NOT the average
   * of the daily rates. Used for both Conv and SEO share; blank rather than 0 when the
   * denominator is empty.
   */
  const rateCells = (numerCol: number, denomCol: number) => {
    const N = colLetter(numerCol);
    const D = colLetter(denomCol);

    return {
      d7: s7.length ? `=IFERROR(SUM(${cellList(N, s7)})/SUM(${cellList(D, s7)}),"")` : '',
      mtd: `=IFERROR(${sumifs(N, mtdLo, mtdHi)}/${sumifs(D, mtdLo, mtdHi)},"")`,
      prev: `=IFERROR(${sumifs(N, prevLo, prevHi)}/${sumifs(D, prevLo, prevHi)},"")`,
    };
  };

  const d7Row: (string | number)[] = ['7d avg'];
  const mtdRow: (string | number)[] = ['MTD'];
  const prevRow: (string | number)[] = ['Prev Month'];

  METRICS.forEach((m, g) => {
    const L = layout[g];
    const seoL = colLetter(L.seo);
    const seo = countCells(L.seo);
    const all = countCells(L.all);
    const share = rateCells(L.seo, L.all);

    // 7d w/w: this week's SEO average vs the previous 7 completed days.
    const p7avg = `AVERAGE(${cellList(seoL, p7)})`;
    const wow7 = p7.length ? `=IFERROR((${seoL}3-${p7avg})/${p7avg},"")` : '';
    // MTD w/w: month-to-date vs the same day-span of the previous month.
    const prevSpan = sumifs(seoL, prevLo, prevSpanHi);
    const wowMtd = `=IFERROR((${seoL}4-${prevSpan})/${prevSpan},"")`;

    if (L.conv !== undefined && m.prevLabel) {
      // Conv's denominator is the previous stage's SEO column, wherever it sits.
      const conv = rateCells(L.seo, layout[metricIndex(m.prevLabel)].seo);

      d7Row.push(conv.d7);
      mtdRow.push(conv.mtd);
      prevRow.push(conv.prev);
    }

    d7Row.push(seo.d7);
    mtdRow.push(seo.mtd);
    prevRow.push(seo.prev);

    if (!m.noWow) {
      d7Row.push(wow7);
      mtdRow.push(wowMtd);
      prevRow.push('');
    }

    d7Row.push(all.d7, share.d7);
    mtdRow.push(all.mtd, share.mtd);
    prevRow.push(all.prev, share.prev);
  });

  const matrix: (string | number)[][] = [groupHeader, subHeader, d7Row, mtdRow, prevRow];

  for (const item of plan) {
    if (item.kind === 'week') {
      matrix.push(weeklyRow(item.members));
      continue;
    }

    const { day, i } = item;
    const weekAgo = days[i + 7];
    const out: (string | number)[] = [day.date];

    for (const m of METRICS) {
      const seoV = m.value(day.seo);
      const allV = m.value(day.all);

      if (m.prevLabel) out.push(ratio(seoV, METRICS[metricIndex(m.prevLabel)].value(day.seo)));
      out.push(round2(seoV));
      if (!m.noWow) out.push(weekAgo ? pct(seoV, m.value(weekAgo.seo)) : '');
      out.push(round2(allV), ratio(seoV, allV));
    }

    matrix.push(out);
  }

  return matrix;
}
