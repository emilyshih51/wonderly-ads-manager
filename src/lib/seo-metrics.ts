/**
 * SEO Metrics — the Motion-style grid for acquisition by CHANNEL, mirroring Daily Metrics.
 *
 * Same layout, same cadence, same reading habits: one row per day newest-first, grouped
 * into ISO-week blocks with a "Week of …" summary row closing each block, under live
 * 7d-avg / MTD / Prev-Month formula rows. Metrics run the funnel backwards so the outcome
 * reads first: Accepted → Held → No show → Call 1 booked → Qualified → Partial → CTA →
 * Page views.
 *
 * Where Daily Metrics splits each metric two ways (FB vs Organic), this tab splits it by
 * every channel, so "was it Google or ChatGPT or direct?" is answerable at every stage:
 *
 *   Daily Metrics:  [Cost]  ALL   [w/w]  FB   Organic
 *   SEO Metrics:    [Conv]  Organic  [w/w]  Google … Brave  AI search  Direct  …  Facebook  All
 *
 * Three things about that layout are deliberate:
 *
 *   - **Conv replaces Cost.** SEO has no media spend to divide by, so the efficiency
 *     question is what share of the previous step converted. It is SEO's OWN conversion
 *     (SEO ÷ previous stage's SEO), since SEO is the column this tab leads with.
 *   - **ALL is not the sum of the channels.** It comes from the query's own day-grain row.
 *     One person can appear in two channels the same day, so the columns can add to slightly
 *     more than ALL; deals that bridge to no channel land only in ALL and in `Unatt.`.
 *   - **`Unatt.` only appears on the cohort metrics** (Accepted / Held / No show). Those come
 *     from CRM deals, where a deal can fail to bridge to any marketing session — outbound,
 *     rep-created, pre-tracking. The flow metrics are read straight off marketing events,
 *     which always carry a channel, so an unattributed column there would be a column of
 *     zeros. On Accepted it is not a rounding error: roughly one accepted contractor in
 *     eight reaches no channel at all.
 *
 * Windowed aggregates use RATIO OF TOTALS, never a mean of daily rates — a day with 3 page
 * views must not weigh the same as a day with 300.
 *
 * Maturation caveat inherited from the rest of the sheet: Held / No show / Accepted are
 * cohort metrics keyed to the deal's booking day, so the newest rows read low until those
 * deals work through the pipeline. Read the weekly rows, not the last daily row.
 *
 * Cron-computed and unit-tested. Written to the "SEO Metrics" tab.
 */

import {
  ALL_CHANNELS,
  SEARCH_ENGINES,
  UNATTRIBUTED,
  type ChannelKey,
  type ChannelFunnelRow,
} from '@/lib/channel';

/** The funnel counts this tab reports, per day, for one channel slice. */
export interface SeoCounts {
  /** Unique PEOPLE with a marketing page view — not visits, not page-view events. */
  pageViews: number;
  cta: number;
  submitPartial: number;
  submitQualified: number;
  booked: number;
  held: number;
  noShow: number;
  accepted: number;
}

const ZERO: SeoCounts = {
  pageViews: 0,
  cta: 0,
  submitPartial: 0,
  submitQualified: 0,
  booked: 0,
  held: 0,
  noShow: 0,
  accepted: 0,
};

/** One column on the grid: a label and the channel rows it sums. */
export interface ColumnSpec {
  label: string;
  /** Channel rows this column totals. More than one only for the derived Organic rollup. */
  keys: ChannelKey[];
}

/**
 * Channel columns in display order.
 *
 * **Organic leads and is derived** — it sums the engine columns that follow it. Summing is
 * safe here in a way it is not for ALL: `initial_referrer` is an Amplitude `$setOnce`
 * property, so a person resolves to exactly one engine for life and cannot be double-counted
 * across two of them. It carries the w/w column and is Conv's basis, because "how is organic
 * search doing" is the question the tab exists to answer; the engines underneath it say which
 * search engine delivered it.
 *
 * Facebook sits last before All: it is the volume baseline you read everything else against,
 * not a thing being studied here — Daily Metrics is where paid gets its own treatment.
 *
 * `Unknown source` renders only on metrics that opt in — see the module docstring.
 */
export const CHANNEL_COLUMNS: ColumnSpec[] = [
  { label: 'Organic', keys: [...SEARCH_ENGINES] },
  { label: 'Google', keys: ['google'] },
  { label: 'Bing', keys: ['bing'] },
  { label: 'DuckDuckGo', keys: ['duckduckgo'] },
  { label: 'Yahoo', keys: ['yahoo'] },
  { label: 'Brave', keys: ['brave'] },
  { label: 'Other engine', keys: ['other_engine'] },
  { label: 'AI search', keys: ['ai'] },
  { label: 'Direct', keys: ['direct'] },
  { label: 'Referral', keys: ['referral'] },
  { label: 'Other campaign', keys: ['other'] },
  { label: 'Unknown source', keys: [UNATTRIBUTED] },
  { label: 'Facebook', keys: ['fb'] },
];

/** The column the grid leads with, and the basis for Conv and w/w. */
const LEAD = CHANNEL_COLUMNS[0];

/** One day, split per channel, plus the independently-counted all-channel total. */
export interface SeoDay {
  date: string;
  byChannel: Map<ChannelKey, SeoCounts>;
  all: SeoCounts;
}

interface SeoMetric {
  label: string;
  value: (c: SeoCounts) => number;
  /**
   * Label of the previous funnel step. Conv = this stage ÷ that stage, within SEO.
   * Referencing by LABEL rather than by accessor keeps one definition of each stage's count
   * and makes the denominator's sheet column findable for the summary-row formulas.
   */
  prevLabel?: string;
  /** Drop the week-over-week column — for tiny-count metrics where w/w is only noise. */
  noWow?: boolean;
  /** Show the `Unatt.` column — cohort metrics read from CRM deals only. */
  showUnattributed?: boolean;
}

/**
 * Reversed-funnel order, matching Daily Metrics so the two tabs read the same way.
 *
 * Accepted and No show drop their w/w for the same reason they do there: organic runs 0–2
 * accepted on a good day, so a day-vs-same-weekday percentage is −100%/+200% noise. The
 * weekly rows are where those two become legible.
 */
const METRICS: SeoMetric[] = [
  {
    label: 'Accepted',
    value: (c) => c.accepted,
    prevLabel: 'Call 1 booked',
    noWow: true,
    showUnattributed: true,
  },
  { label: 'Held', value: (c) => c.held, prevLabel: 'Call 1 booked', showUnattributed: true },
  // A disposition of a booked call, not a funnel step — it converts against nothing.
  { label: 'No show', value: (c) => c.noShow, noWow: true, showUnattributed: true },
  { label: 'Call 1 booked', value: (c) => c.booked, prevLabel: 'Qualified' },
  { label: 'Qualified', value: (c) => c.submitQualified, prevLabel: 'Partial' },
  { label: 'Partial', value: (c) => c.submitPartial, prevLabel: 'CTA' },
  { label: 'CTA', value: (c) => c.cta, prevLabel: 'Page views' },
  // Top of funnel — nothing precedes it, so no Conv column.
  { label: 'Page views', value: (c) => c.pageViews },
];

/** Metric shape in column order — the formatter must stay in step with this. */
export const SEO_METRICS_LABELS = METRICS.map((m) => ({
  label: m.label,
  hasConv: Boolean(m.prevLabel),
  noWow: Boolean(m.noWow),
  showUnattributed: Boolean(m.showUnattributed),
}));

/** Columns rendered for one metric (drops `Unknown source` unless the metric opts in). */
function channelsFor(m: { showUnattributed?: boolean }): ColumnSpec[] {
  return CHANNEL_COLUMNS.filter((c) => c.keys[0] !== UNATTRIBUTED || m.showUnattributed);
}

/** Columns rendered after the lead column — everything except Organic itself. */
function trailingFor(m: { showUnattributed?: boolean }): ColumnSpec[] {
  return channelsFor(m).filter((c) => c !== LEAD);
}

/** Index of a metric by label. Throws on a typo'd `prevLabel` rather than silently skipping. */
function metricIndex(label: string): number {
  const i = METRICS.findIndex((m) => m.label === label);

  if (i === -1) throw new Error(`SEO metric "${label}" is not defined`);

  return i;
}

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
    pageViews: a.pageViews + b.pageViews,
    cta: a.cta + b.cta,
    submitPartial: a.submitPartial + b.submitPartial,
    submitQualified: a.submitQualified + b.submitQualified,
    booked: a.booked + b.booked,
    held: a.held + b.held,
    noShow: a.noShow + b.noShow,
    accepted: a.accepted + b.accepted,
  };
}

/** Counts for one column on one day — sums its channel rows, zero-filled when absent. */
function slice(day: SeoDay | undefined, col: ColumnSpec): SeoCounts {
  return col.keys.reduce((acc, k) => addCounts(acc, day?.byChannel.get(k) ?? ZERO), { ...ZERO });
}

/**
 * Collapse the long (day, channel) rows into one entry per day.
 *
 * The `all` total is taken from the query's own `all` row — a day-grain COUNT(DISTINCT …) —
 * never by summing the channel rows. A person active in two channels the same day appears in
 * both, so a sum runs high and would break the tie-out to `wonderly_daily`.
 *
 * @param rows - Long-format rows from `SnowflakeService.getChannelFunnel`
 * @param minDate - Floor date (`YYYY-MM-DD`); older rows are dropped
 * @returns One entry per day with any activity, newest day first
 */
export function toSeoDays(rows: ChannelFunnelRow[], minDate: string): SeoDay[] {
  const byDate = new Map<string, SeoDay>();

  for (const r of rows) {
    if (r.date < minDate) continue;

    const day = byDate.get(r.date) ?? {
      date: r.date,
      byChannel: new Map<ChannelKey, SeoCounts>(),
      all: { ...ZERO },
    };
    const counts: SeoCounts = {
      pageViews: r.pageViews,
      cta: r.cta,
      submitPartial: r.submitPartial,
      submitQualified: r.submitQualified,
      booked: r.booked,
      held: r.held,
      noShow: r.noShow,
      accepted: r.accepted,
    };

    if (r.channel === ALL_CHANNELS) day.all = counts;
    else day.byChannel.set(r.channel, addCounts(day.byChannel.get(r.channel) ?? ZERO, counts));

    byDate.set(r.date, day);
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * One weekly summary row: sums for the counts, ratio-of-totals for Conv, and a blank w/w
 * cell (a week-total w/w would mix meanings with the same-weekday w/w that column carries
 * on daily rows).
 *
 * Labelled "Week of <Monday>" so the formatter can find it and so the date-criteria SUMIFS
 * in the summary rows skip it — its column A is text, not a date.
 */
function weeklyRow(members: SeoDay[]): (string | number)[] {
  const totals = new Map<ColumnSpec, SeoCounts>();

  for (const c of CHANNEL_COLUMNS) {
    totals.set(c, members.map((m) => slice(m, c)).reduce(addCounts, { ...ZERO }));
  }

  const all = members.map((m) => m.all).reduce(addCounts, { ...ZERO });
  const lead = totals.get(LEAD) ?? ZERO;
  const out: (string | number)[] = [`Week of ${weekKey(members[members.length - 1].date)}`];

  for (const m of METRICS) {
    if (m.prevLabel) out.push(ratio(m.value(lead), METRICS[metricIndex(m.prevLabel)].value(lead)));
    out.push(m.value(lead));
    if (!m.noWow) out.push('');

    for (const c of trailingFor(m)) out.push(m.value(totals.get(c) ?? ZERO));

    out.push(m.value(all));
  }

  return out;
}

/**
 * Build the SEO Metrics matrix.
 *
 * Layout mirrors Daily Metrics: a merged group-header row, a sub-header row, the 7d-avg /
 * MTD / Prev-Month rows, then daily rows newest-first in ISO-week blocks each closed by a
 * weekly summary row.
 *
 * The three summary rows are live Google Sheets FORMULAS (=AVERAGE / =SUMIFS) rather than
 * pre-computed values, so the math stays visible and editable in the sheet and the month
 * windows self-advance via EOMONTH(TODAY()) instead of baking in dates. Data starts at
 * sheet row 6.
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
  // formulas can list those rows explicitly despite the interleaved weekly rows.
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

  // Per-metric column layout: [Conv] SEO [w/w] <other channels> [Unatt.] FB ALL.
  let colIdx = 1;
  const layout = METRICS.map((m) => {
    const conv = m.prevLabel ? colIdx++ : undefined;
    const lead = colIdx++;
    const wow = m.noWow ? undefined : colIdx++;
    const others = trailingFor(m).map(() => colIdx++);
    const all = colIdx++;

    return { conv, lead, wow, others, all };
  });

  const groupHeader: (string | number)[] = [''];
  const subHeader: (string | number)[] = ['Date'];

  METRICS.forEach((m) => {
    const cols: string[] = [];

    if (m.prevLabel) cols.push('Conv');
    cols.push(LEAD.label);
    if (!m.noWow) cols.push('w/w');
    for (const c of trailingFor(m)) cols.push(c.label);
    cols.push('All');

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
   * A rate over a window = ratio of totals (Σ numerator ÷ Σ denominator), NOT the average of
   * the daily rates. Blank rather than 0 when the denominator is empty.
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
    const leadL = colLetter(L.lead);
    const lead = countCells(L.lead);

    // 7d w/w: this week's SEO average vs the previous 7 completed days.
    const p7avg = `AVERAGE(${cellList(leadL, p7)})`;
    const wow7 = p7.length ? `=IFERROR((${leadL}3-${p7avg})/${p7avg},"")` : '';
    // MTD w/w: month-to-date vs the same day-span of the previous month.
    const prevSpan = sumifs(leadL, prevLo, prevSpanHi);
    const wowMtd = `=IFERROR((${leadL}4-${prevSpan})/${prevSpan},"")`;

    if (L.conv !== undefined && m.prevLabel) {
      // Conv's denominator is the previous stage's Organic column, wherever it sits.
      const conv = rateCells(L.lead, layout[metricIndex(m.prevLabel)].lead);

      d7Row.push(conv.d7);
      mtdRow.push(conv.mtd);
      prevRow.push(conv.prev);
    }

    d7Row.push(lead.d7);
    mtdRow.push(lead.mtd);
    prevRow.push(lead.prev);

    if (!m.noWow) {
      d7Row.push(wow7);
      mtdRow.push(wowMtd);
      prevRow.push('');
    }

    for (const col of L.others) {
      const cells = countCells(col);

      d7Row.push(cells.d7);
      mtdRow.push(cells.mtd);
      prevRow.push(cells.prev);
    }

    const all = countCells(L.all);

    d7Row.push(all.d7);
    mtdRow.push(all.mtd);
    prevRow.push(all.prev);
  });

  const matrix: (string | number)[][] = [groupHeader, subHeader, d7Row, mtdRow, prevRow];

  for (const item of plan) {
    if (item.kind === 'week') {
      matrix.push(weeklyRow(item.members));
      continue;
    }

    const { day, i } = item;
    const weekAgo = days[i + 7];
    const lead = slice(day, LEAD);
    const out: (string | number)[] = [day.date];

    for (const m of METRICS) {
      const leadV = m.value(lead);

      if (m.prevLabel) out.push(ratio(leadV, METRICS[metricIndex(m.prevLabel)].value(lead)));
      out.push(round2(leadV));
      if (!m.noWow) out.push(weekAgo ? pct(leadV, m.value(slice(weekAgo, LEAD))) : '');

      for (const c of trailingFor(m)) out.push(round2(m.value(slice(day, c))));

      out.push(round2(m.value(day.all)));
    }

    matrix.push(out);
  }

  return matrix;
}
