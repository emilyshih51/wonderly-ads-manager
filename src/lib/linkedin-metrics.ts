/**
 * LinkedIn Daily Metrics — the LinkedIn test in EXACTLY the Daily Metrics layout (same
 * group/sub-header rows, live 7d avg / MTD / Prev Month formula rows, daily rows newest
 * first in ISO-week blocks closed by a "Week of …" row, Cost + w/w columns, heat-map), kept
 * on its own tab so nothing about the trusted Daily Metrics tab changes.
 *
 * Every group keeps Daily Metrics' column shape — [Cost] ALL [w/w] FB Organic — so the shared
 * `buildDailyMetricsFormatRequests` formats it identically. LinkedIn has no channel split, so
 * the FB / Organic columns are written blank and hidden by the format spec.
 *
 * Metrics run the funnel backwards like Daily Metrics. LinkedIn's funnel has no landing page /
 * CTA step (ads and messages link straight to the form on hi.wonderly.com):
 *   Accepted → Held → No show → Call 1 booked → Direct booked → Qualified → Partial
 *     → Form opened → Engagements → Clicks → CPC → Spend
 *
 * - Spend / clicks (landing-page clicks) / engagements: LinkedIn Advertising API.
 * - Form opened → Accepted: Amplitude + CRM via `SnowflakeService.getLinkedinFunnel`, same
 *   rules as Daily Metrics. Direct booked = the `?mode=book` link that skips the form.
 * - Cost = LinkedIn spend ÷ that stage's count; ratio of totals in the summary rows.
 *
 * Held / No show / Accepted are cohort metrics keyed to booking day, so recent rows read low
 * until deals mature — same caveat as Daily Metrics.
 */

import type { MetricFormat } from '@/lib/daily-metrics-format';
import type { LinkedInDailySpend } from '@/services/linkedin';

/** One day of the LinkedIn funnel from Snowflake. */
export interface LinkedinFunnelRow {
  date: string;
  formOpened: number;
  partial: number;
  qualified: number;
  call1Booked: number;
  directBooked: number;
  held: number;
  noShow: number;
  accepted: number;
}

/** A day with LinkedIn delivery and funnel joined. */
export interface LinkedinDay extends LinkedinFunnelRow {
  spend: number;
  impressions: number;
  clicks: number;
  engagements: number;
}

const ZERO: Omit<LinkedinDay, 'date'> = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  engagements: 0,
  formOpened: 0,
  partial: 0,
  qualified: 0,
  call1Booked: 0,
  directBooked: 0,
  held: 0,
  noShow: 0,
  accepted: 0,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Shift a `YYYY-MM-DD` by whole days. */
function shiftDay(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() + n);

  return d.toISOString().slice(0, 10);
}

/**
 * Join LinkedIn delivery to the Snowflake funnel on date. A date in either source produces a
 * row: spend with no funnel is a real (dead) day; funnel with no spend is a LinkedIn-tagged
 * visit outside a paid flight (e.g. a hand-tagged message link). Days before LinkedIn's first
 * activity are dropped so the tab starts at launch.
 */
export function joinLinkedinDays(
  spend: LinkedInDailySpend[],
  funnel: LinkedinFunnelRow[]
): LinkedinDay[] {
  const byDate = new Map<string, LinkedinDay>();

  for (const s of spend) {
    byDate.set(s.date, {
      ...ZERO,
      date: s.date,
      spend: s.spend,
      impressions: s.impressions,
      clicks: s.landingPageClicks,
      engagements: s.engagements,
    });
  }

  for (const f of funnel) {
    const d = byDate.get(f.date) ?? { ...ZERO, date: f.date };

    byDate.set(f.date, { ...d, ...f, date: f.date });
  }

  const hasActivity = (d: LinkedinDay) =>
    d.spend > 0 ||
    d.impressions > 0 ||
    d.formOpened > 0 ||
    d.partial > 0 ||
    d.qualified > 0 ||
    d.call1Booked > 0 ||
    d.directBooked > 0 ||
    d.held > 0 ||
    d.noShow > 0 ||
    d.accepted > 0;

  const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  const firstActive = days.filter(hasActivity).at(-1)?.date;

  if (!firstActive) return [];

  // Fill every calendar day from launch to the newest date, so a no-delivery day still gets a
  // row (zeros) — w/w compares against the row 7 back and needs contiguous days.
  const out: LinkedinDay[] = [];
  const newest = days[0].date;

  for (let d = newest; d >= firstActive; d = shiftDay(d, -1)) {
    out.push(byDate.get(d) ?? { ...ZERO, date: d });
  }

  return out;
}

interface Metric {
  label: string;
  daily: (r: LinkedinDay) => number;
  numer?: (r: LinkedinDay) => number;
  denom?: (r: LinkedinDay) => number;
  hasCost?: boolean;
  noWow?: boolean;
  money?: boolean;
  wholeDollars?: boolean;
}

/** Reversed funnel, outcome first — same reading order as Daily Metrics. */
const METRICS: Metric[] = [
  { label: 'Accepted', daily: (r) => r.accepted, hasCost: true, noWow: true },
  { label: 'Held', daily: (r) => r.held, hasCost: true },
  { label: 'No show', daily: (r) => r.noShow, noWow: true },
  { label: 'Call 1 booked', daily: (r) => r.call1Booked, hasCost: true },
  // The ?mode=book link that skips the form — kept apart so it doesn't distort the form funnel.
  { label: 'Direct booked', daily: (r) => r.directBooked, hasCost: true, noWow: true },
  { label: 'Qualified', daily: (r) => r.qualified, hasCost: true },
  { label: 'Partial', daily: (r) => r.partial, hasCost: true },
  { label: 'Form opened', daily: (r) => r.formOpened, hasCost: true },
  { label: 'Engagements', daily: (r) => r.engagements, hasCost: true },
  { label: 'Clicks', daily: (r) => r.clicks, hasCost: true },
  {
    label: 'CPC',
    daily: (r) => (r.clicks > 0 ? r.spend / r.clicks : 0),
    numer: (r) => r.spend,
    denom: (r) => r.clicks,
    money: true,
  },
  { label: 'Spend', daily: (r) => r.spend, money: true, wholeDollars: true },
];

/**
 * Format spec for `buildDailyMetricsFormatRequests`, in the order the matrix is written. FB and
 * Organic are hidden on every group — LinkedIn has no channel split.
 */
export const LINKEDIN_DAILY_METRICS_FORMAT: MetricFormat[] = METRICS.map((m) => ({
  label: m.label,
  money: Boolean(m.money),
  wholeDollars: m.wholeDollars,
  hasCost: m.hasCost,
  noWow: m.noWow,
  hideFb: true,
  hideOrganic: true,
}));

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pct(now: number, base: number): number | '' {
  return base > 0 ? round4((now - base) / base) : '';
}

/** Monday (UTC) of a date's week. */
function weekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));

  return d.toISOString().slice(0, 10);
}

/** 0-based column index → A1 letter. */
function colLetter(index: number): string {
  let s = '';
  let i = index + 1;

  while (i > 0) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    i = Math.floor((i - 1) / 26);
  }

  return s;
}

/** "Week of <Monday>" summary row: sums, ratio-of-totals for CPC / Cost, blank w/w. */
function weeklyRow(members: LinkedinDay[]): (string | number)[] {
  const weekSpend = members.reduce((s, r) => s + r.spend, 0);
  const out: (string | number)[] = [`Week of ${weekKey(members[0].date)}`];

  for (const m of METRICS) {
    const count = members.reduce((s, r) => s + m.daily(r), 0);
    let allV: number;

    if (m.numer && m.denom) {
      const numer = m.numer;
      const denom = members.reduce((s, r) => s + m.denom!(r), 0);

      allV = denom > 0 ? round2(members.reduce((s, r) => s + numer(r), 0) / denom) : 0;
    } else {
      allV = round2(count);
    }

    if (m.hasCost) out.push(count > 0 ? round2(weekSpend / count) : '');
    out.push(allV);
    if (!m.noWow) out.push('');
    out.push('', '');
  }

  return out;
}

/**
 * Build the LinkedIn Daily Metrics matrix — same shape and formulas as `computeDailyMetrics`:
 * row 1 group header, row 2 sub-header, rows 3–5 live 7d avg / MTD / Prev Month formulas,
 * then daily rows (newest first) in ISO-week blocks each closed by a "Week of …" row.
 *
 * @param rows - Output of {@link joinLinkedinDays}, newest first
 * @param today - Pacific `YYYY-MM-DD`; today's partial row is skipped in the 7d average
 * @returns The full matrix, header rows included
 */
export function computeLinkedinDailyMetrics(
  rows: LinkedinDay[],
  today: string
): (string | number)[][] {
  type PlanItem =
    | { kind: 'day'; row: LinkedinDay; i: number }
    | { kind: 'week'; members: LinkedinDay[] };
  const plan: PlanItem[] = [];
  let members: LinkedinDay[] = [];

  rows.forEach((r, i) => {
    plan.push({ kind: 'day', row: r, i });
    members.push(r);

    if (i === rows.length - 1 || weekKey(rows[i + 1].date) !== weekKey(r.date)) {
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

  // Before launch there are no data rows; keep the formula ranges valid (row 6 only).
  const dataEnd = Math.max(sheetRow - 1, 6);

  const mtdLo = '(EOMONTH(TODAY(),-1)+1)';
  const mtdHi = 'TODAY()';
  const prevLo = '(EOMONTH(TODAY(),-2)+1)';
  const prevHi = 'EOMONTH(TODAY(),-1)';
  const prevSpanHi = 'MIN(EOMONTH(TODAY(),-2)+DAY(TODAY()),EOMONTH(TODAY(),-1))';

  const completedRows = dailyRowNums.slice(rows[0]?.date === today ? 1 : 0);
  const s7 = completedRows.slice(0, 7);
  const p7 = completedRows.slice(7, 14);
  const cellList = (L: string, nums: number[]) => nums.map((n) => `${L}${n}`).join(',');

  let colIdx = 1;
  const layout = METRICS.map((m) => {
    const cost = m.hasCost ? colIdx++ : undefined;
    const all = colIdx++;
    const wow = m.noWow ? undefined : colIdx++;
    const fb = colIdx++;
    const organic = colIdx++;

    return { cost, all, wow, fb, organic };
  });
  const spendAll = colLetter(layout[METRICS.findIndex((m) => m.label === 'Spend')].all);

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

  const dateRange = `$A$6:$A$${dataEnd}`;
  const sumifs = (L: string, lo: string, hi: string) =>
    `SUMIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&${lo},${dateRange},"<="&${hi})`;
  const avgifs = (L: string, lo: string, hi: string) =>
    `AVERAGEIFS(${L}$6:${L}$${dataEnd},${dateRange},">="&${lo},${dateRange},"<="&${hi})`;

  const d7Row: (string | number)[] = ['7d avg'];
  const mtdRow: (string | number)[] = ['MTD'];
  const prevRow: (string | number)[] = ['Prev Month'];

  METRICS.forEach((m, g) => {
    const La = colLetter(layout[g].all);
    const ratio = Boolean(m.numer && m.denom);

    if (m.hasCost) {
      d7Row.push(
        s7.length ? `=IFERROR(SUM(${cellList(spendAll, s7)})/SUM(${cellList(La, s7)}),0)` : 0
      );
      mtdRow.push(`=IFERROR(${sumifs(spendAll, mtdLo, mtdHi)}/${sumifs(La, mtdLo, mtdHi)},0)`);
      prevRow.push(`=IFERROR(${sumifs(spendAll, prevLo, prevHi)}/${sumifs(La, prevLo, prevHi)},0)`);
    }

    d7Row.push(s7.length ? `=IFERROR(AVERAGE(${cellList(La, s7)}),0)` : 0);
    mtdRow.push(ratio ? `=IFERROR(${avgifs(La, mtdLo, mtdHi)},0)` : `=${sumifs(La, mtdLo, mtdHi)}`);
    prevRow.push(
      ratio ? `=IFERROR(${avgifs(La, prevLo, prevHi)},0)` : `=${sumifs(La, prevLo, prevHi)}`
    );

    if (!m.noWow) {
      const p7avg = `AVERAGE(${cellList(La, p7)})`;
      const prevSpan = ratio ? avgifs(La, prevLo, prevSpanHi) : sumifs(La, prevLo, prevSpanHi);

      d7Row.push(p7.length ? `=IFERROR((${La}3-${p7avg})/${p7avg},"")` : '');
      mtdRow.push(`=IFERROR((${La}4-${prevSpan})/${prevSpan},"")`);
      prevRow.push('');
    }

    // FB / Organic: no LinkedIn channel split — blank (and hidden by the format spec).
    d7Row.push('', '');
    mtdRow.push('', '');
    prevRow.push('', '');
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

      if (m.hasCost) out.push(count > 0 ? round2(r.spend / count) : '');
      out.push(round2(count));
      if (!m.noWow) out.push(weekAgo ? pct(count, m.daily(weekAgo)) : '');
      out.push('', '');
    }

    matrix.push(out);
  }

  return matrix;
}
