import { describe, expect, it } from 'vitest';

import type { ChannelKey, ChannelFunnelRow } from '@/lib/channel';
import { SEO_METRICS_LABELS, computeSeoMetrics, toSeoDays, type SeoDay } from '@/lib/seo-metrics';
import { buildSeoMetricsFormatRequests } from '@/lib/seo-metrics-format';

function row(
  date: string,
  channel: ChannelKey,
  o: Partial<ChannelFunnelRow> = {}
): ChannelFunnelRow {
  return {
    date,
    channel,
    pageViews: 0,
    cta: 0,
    submitPartial: 0,
    submitQualified: 0,
    booked: 0,
    held: 0,
    noShow: 0,
    accepted: 0,
    ...o,
  };
}

/**
 * A full week (Mon 2026-08-03 … Sun 2026-08-09) plus one day of the next, newest first.
 *
 * The `all` row is deliberately NOT the sum of the channel rows: its page views are lower
 * than seo + fb (one person active in both channels that day) and its accepted is higher
 * (one deal no channel could be found for). Anything that sums channels instead of reading
 * the `all` row fails these fixtures.
 */
function fixture(): ChannelFunnelRow[] {
  const out: ChannelFunnelRow[] = [];

  for (let d = 3; d <= 10; d++) {
    const date = `2026-08-${String(d).padStart(2, '0')}`;

    out.push(
      row(date, 'seo', {
        pageViews: 100,
        cta: 20,
        submitPartial: 10,
        submitQualified: 4,
        booked: 2,
        held: 1,
        noShow: 1,
        accepted: 1,
      })
    );
    out.push(row(date, 'fb', { pageViews: 901, cta: 180, booked: 18, held: 9, accepted: 4 }));
    out.push(row(date, 'ai', { pageViews: 3, cta: 1 }));
    out.push(row(date, 'direct', { pageViews: 40, cta: 5 }));
    out.push(row(date, 'referral', { pageViews: 8 }));
    out.push(row(date, 'other', { pageViews: 6 }));
    // Only ever on the cohort metrics — a deal that bridged to no marketing session.
    out.push(row(date, 'unattributed', { held: 1, accepted: 1, noShow: 1 }));
    out.push(
      row(date, 'all', {
        pageViews: 1000,
        cta: 200,
        submitPartial: 100,
        submitQualified: 40,
        booked: 20,
        held: 10,
        noShow: 5,
        accepted: 6,
      })
    );
  }

  return out;
}

const HEADERS = (m: (string | number)[][]): string[] => m[1].map(String);

/** Counts for one channel on a day, zero-filled — mirrors the module's own `slice`. */
const ch = (d: SeoDay, key: string) =>
  d.byChannel.get(key as never) ?? {
    pageViews: 0,
    cta: 0,
    submitPartial: 0,
    submitQualified: 0,
    booked: 0,
    held: 0,
    noShow: 0,
    accepted: 0,
  };

/**
 * Column index of `colName` inside the `groupLabel` group. Group names live on the merged
 * row 0 and sub-headers on row 1, so a group's span runs from its label until the next
 * non-empty row-0 cell.
 */
function groupCol(m: (string | number)[][], groupLabel: string, colName: string): number {
  const start = m[0].map(String).indexOf(groupLabel);

  expect(start).toBeGreaterThan(0);

  let end = start + 1;

  while (end < m[0].length && String(m[0][end]) === '') end++;

  const idx = HEADERS(m).slice(start, end).indexOf(colName);

  expect(idx).toBeGreaterThanOrEqual(0);

  return start + idx;
}

describe('toSeoDays', () => {
  it('splits each day into the SEO slice and the all-channel total, newest first', () => {
    const days = toSeoDays(
      [
        row('2026-08-01', 'seo', { pageViews: 10, accepted: 1 }),
        row('2026-08-01', 'fb', { pageViews: 90, accepted: 3 }),
        row('2026-08-01', 'all', { pageViews: 97, accepted: 5 }),
        row('2026-08-02', 'direct', { pageViews: 50 }),
        row('2026-08-02', 'all', { pageViews: 50 }),
      ],
      '2026-01-01'
    );

    expect(days.map((d) => d.date)).toEqual(['2026-08-02', '2026-08-01']);
    expect(ch(days[1], 'seo').pageViews).toBe(10);
    expect(ch(days[1], 'fb').pageViews).toBe(90);
    // A day with no organic traffic still reports its all-channel total.
    expect(ch(days[0], 'seo').pageViews).toBe(0);
    expect(days[0].all.pageViews).toBe(50);
  });

  it('takes the total from the all row, never by summing channels', () => {
    const days = toSeoDays(
      [
        row('2026-08-01', 'seo', { pageViews: 10, accepted: 1 }),
        row('2026-08-01', 'fb', { pageViews: 90, accepted: 3 }),
        // Fewer page views than seo + fb (someone was active in both channels) and more
        // accepted (one deal bridged to no channel at all).
        row('2026-08-01', 'all', { pageViews: 97, accepted: 5 }),
      ],
      '2026-01-01'
    );

    expect(days[0].all.pageViews).toBe(97);
    expect(days[0].all.accepted).toBe(5);
    // The channels themselves still read their own values.
    expect(ch(days[0], 'seo').pageViews + ch(days[0], 'fb').pageViews).toBe(100);
  });

  it('keeps unattributed as its own channel, never folded into another', () => {
    const days = toSeoDays(
      [
        row('2026-08-01', 'seo', { accepted: 1 }),
        row('2026-08-01', 'unattributed', { accepted: 4 }),
        row('2026-08-01', 'all', { accepted: 5 }),
      ],
      '2026-01-01'
    );

    expect(ch(days[0], 'seo').accepted).toBe(1);
    expect(ch(days[0], 'unattributed').accepted).toBe(4);
    expect(days[0].all.accepted).toBe(5);
  });

  it('drops days before the floor date', () => {
    const days = toSeoDays(
      [row('2026-04-30', 'seo', { pageViews: 5 }), row('2026-05-01', 'seo', { pageViews: 7 })],
      '2026-05-01'
    );

    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-05-01');
  });
});

describe('computeSeoMetrics layout', () => {
  const m = computeSeoMetrics(fixture(), '2026-08-11', '2026-01-01');

  it('mirrors the Daily Metrics header shape', () => {
    expect(m[1][0]).toBe('Date');
    expect(m[2][0]).toBe('7d avg');
    expect(m[3][0]).toBe('MTD');
    expect(m[4][0]).toBe('Prev Month');
    // Group header carries each metric name once, merged across its columns.
    expect(m[0].filter(Boolean)).toEqual([
      'Accepted',
      'Held',
      'No show',
      'Call 1 booked',
      'Qualified',
      'Partial',
      'CTA',
      'Page views',
    ]);
  });

  it('gives every group a SEO / ALL / SEO % column and keeps rows rectangular', () => {
    const headers = HEADERS(m);

    expect(headers.filter((h) => h === 'SEO')).toHaveLength(8);
    expect(headers.filter((h) => h === 'ALL')).toHaveLength(8);

    // Every channel gets a column on every metric...
    for (const label of ['AI', 'Direct', 'Referral', 'Other', 'FB']) {
      expect(headers.filter((h) => h === label)).toHaveLength(8);
    }

    // ...except Unatt., which only makes sense on the three CRM-sourced cohort metrics.
    expect(headers.filter((h) => h === 'Unatt.')).toHaveLength(3);
    // Conv on every stage except the top of funnel (Page views) and No show.
    expect(headers.filter((h) => h === 'Conv')).toHaveLength(6);
    // w/w everywhere except Accepted and No show.
    expect(headers.filter((h) => h === 'w/w')).toHaveLength(6);
    for (const line of m) expect(line).toHaveLength(m[0].length);
  });

  it('matches the format module on which groups carry Conv and w/w', () => {
    expect(SEO_METRICS_LABELS.filter((x) => x.hasConv)).toHaveLength(6);
    expect(SEO_METRICS_LABELS.filter((x) => x.noWow).map((x) => x.label)).toEqual([
      'Accepted',
      'No show',
    ]);
    expect(SEO_METRICS_LABELS.filter((x) => x.showUnattributed).map((x) => x.label)).toEqual([
      'Accepted',
      'Held',
      'No show',
    ]);
  });
});

describe('computeSeoMetrics rows', () => {
  const m = computeSeoMetrics(fixture(), '2026-08-11', '2026-01-01');
  const body = m.slice(5);

  it('emits daily rows newest-first with a weekly row closing each ISO week', () => {
    const labels = body.map((r) => String(r[0]));

    // 2026-08-10 is a Monday, so it sits in its own week block above the 08-03..08-09 week.
    expect(labels[0]).toBe('2026-08-10');
    expect(labels[1]).toBe('Week of 2026-08-10');
    expect(labels[2]).toBe('2026-08-09');
    expect(labels[labels.length - 1]).toBe('Week of 2026-08-03');
  });

  it('sums the week into its weekly row, as ratio-of-totals for the rates', () => {
    const week = body.find((r) => r[0] === 'Week of 2026-08-03')!;

    // Seven days x 100 organic sessions, against 7 x 1000 all-channel.
    expect(week[groupCol(m, 'Page views', 'SEO')]).toBe(700);
    expect(week[groupCol(m, 'Page views', 'FB')]).toBe(6307);
    expect(week[groupCol(m, 'Page views', 'AI')]).toBe(21);
    expect(week[groupCol(m, 'Page views', 'ALL')]).toBe(7000);
    // Accepted 7 of 14 booked — a rate over the week, not a sum of daily rates.
    expect(week[groupCol(m, 'Accepted', 'Conv')]).toBe(0.5);
  });

  it('computes step conversion inside the SEO slice only', () => {
    const day = body[0];

    // CTA group: Conv = SEO cta / SEO page views = 20 / 100 — organic's own rate, even though
    // FB contributed 180 CTAs from 901 page views on the same day.
    expect(day[groupCol(m, 'CTA', 'Conv')]).toBe(0.2);
    expect(day[groupCol(m, 'Qualified', 'Conv')]).toBe(0.4); // 4 / 10 partial
  });

  it('computes SEO share against the all-channel total, not against itself', () => {
    const day = body[0];

    expect(day[groupCol(m, 'Page views', 'SEO')]).toBe(100);
    expect(day[groupCol(m, 'Page views', 'AI')]).toBe(3);
    expect(day[groupCol(m, 'Page views', 'Direct')]).toBe(40);
    expect(day[groupCol(m, 'Page views', 'Referral')]).toBe(8);
    expect(day[groupCol(m, 'Page views', 'Other')]).toBe(6);
    expect(day[groupCol(m, 'Page views', 'FB')]).toBe(901);
    // ALL is the query's own day-grain row, NOT the sum of the channels above (1058).
    expect(day[groupCol(m, 'Page views', 'ALL')]).toBe(1000);
    // The unattributed deal shows in its own column and in ALL, on cohort metrics only.
    expect(day[groupCol(m, 'Accepted', 'Unatt.')]).toBe(1);
    expect(day[groupCol(m, 'Accepted', 'ALL')]).toBe(6);
  });

  it('leaves a rate blank rather than 0 when its denominator is empty', () => {
    const m2 = computeSeoMetrics([row('2026-08-10', 'seo')], '2026-08-11', '2026-01-01');
    const day = m2[5];

    expect(day[groupCol(m2, 'CTA', 'Conv')]).toBe('');
  });

  it('writes the summary rows as live sheet formulas, not baked values', () => {
    expect(String(m[3][1])).toContain('EOMONTH(TODAY()');
    expect(String(m[2][1]).startsWith('=')).toBe(true);
    // Rates aggregate as ratio-of-totals (a division of two SUMIFS), never AVERAGE of rates.
    const mtdConv = String(m[3][groupCol(m, 'CTA', 'Conv')]);

    expect(mtdConv).toContain('SUMIFS');
    expect(mtdConv).toContain('/');
    expect(mtdConv).not.toContain('AVERAGE');
  });

  it('skips today’s partial row from the 7d average', () => {
    const withToday = computeSeoMetrics(fixture(), '2026-08-10', '2026-01-01');

    // Today is the first daily row (sheet row 6), so the 7d list must start at row 7.
    expect(String(withToday[2][1])).not.toContain('B6');
  });

  it('handles an empty window without throwing', () => {
    const empty = computeSeoMetrics([], '2026-08-11', '2026-01-01');

    expect(empty).toHaveLength(5);
    expect(empty[2][0]).toBe('7d avg');
  });
});

describe('buildSeoMetricsFormatRequests', () => {
  const m = computeSeoMetrics(fixture(), '2026-08-11', '2026-01-01');
  const requests = buildSeoMetricsFormatRequests(7, SEO_METRICS_LABELS, m);
  const json = JSON.stringify(requests);

  it('freezes the two headers plus three summary rows and the date column', () => {
    expect(json).toContain('"frozenRowCount":5');
    expect(json).toContain('"frozenColumnCount":1');
  });

  it('unmerges before merging so a re-run is idempotent', () => {
    expect(Object.keys(requests[0])[0]).toBe('unmergeCells');
    expect(requests.filter((r) => 'mergeCells' in r)).toHaveLength(8);
  });

  it('adds a w/w heat-map for each w/w column', () => {
    expect(requests.filter((r) => 'addConditionalFormatRule' in r)).toHaveLength(6);
  });

  it('shades and borders every weekly summary row', () => {
    const weekRows = m.filter((r) => String(r[0]).startsWith('Week of')).length;

    expect(weekRows).toBe(2);
    expect(requests.filter((r) => 'updateBorders' in r)).toHaveLength(weekRows + 1); // +1 clear
  });
});
