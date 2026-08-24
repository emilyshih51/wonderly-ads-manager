import { describe, expect, it } from 'vitest';

import type { Channel } from '@/lib/channel';
import {
  SEO_FUNNEL_HEADERS,
  SEO_FUNNEL_COMPARISON_START,
  buildSeoFunnelFormatRequests,
  pivotChannelFunnel,
  toSeoFunnelValues,
  type ChannelFunnelRow,
} from '@/lib/seo-funnel';

function row(date: string, channel: Channel, o: Partial<ChannelFunnelRow> = {}): ChannelFunnelRow {
  return {
    date,
    channel,
    sessions: 0,
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

const H = (name: string): number => (SEO_FUNNEL_HEADERS as readonly string[]).indexOf(name);

describe('pivotChannelFunnel', () => {
  it('groups by date and orders dates newest first', () => {
    const { dates, byDate } = pivotChannelFunnel([
      row('2026-08-01', 'seo', { sessions: 5 }),
      row('2026-08-03', 'fb', { sessions: 9 }),
      row('2026-08-03', 'seo', { sessions: 7 }),
    ]);

    expect(dates).toEqual(['2026-08-03', '2026-08-01']);
    expect(byDate.get('2026-08-03')?.get('seo')?.sessions).toBe(7);
    expect(byDate.get('2026-08-03')?.get('fb')?.sessions).toBe(9);
  });
});

describe('toSeoFunnelValues', () => {
  const rows = [
    row('2026-08-02', 'seo', {
      sessions: 100,
      cta: 20,
      submitPartial: 10,
      submitQualified: 4,
      booked: 2,
      held: 1,
      accepted: 1,
    }),
    row('2026-08-02', 'fb', { sessions: 900, booked: 30, accepted: 5 }),
    row('2026-08-01', 'seo', {
      sessions: 100,
      cta: 10,
      submitPartial: 6,
      submitQualified: 2,
      booked: 2,
      held: 2,
      accepted: 1,
    }),
  ];

  it('emits a header-aligned row per day, newest first, under a Total row', () => {
    const values = toSeoFunnelValues(rows, '2026-01-01');

    expect(values[0][0]).toBe('Total');
    expect(values[1][0]).toBe('2026-08-02');
    expect(values[2][0]).toBe('2026-08-01');
    for (const line of values) expect(line).toHaveLength(SEO_FUNNEL_HEADERS.length);
  });

  it('computes step conversions against the previous step', () => {
    const [, aug2] = toSeoFunnelValues(rows, '2026-01-01');

    expect(aug2[H('SEO_CTA_RATE')]).toBe(0.2); // 20 / 100 sessions
    expect(aug2[H('SEO_PARTIAL_RATE')]).toBe(0.5); // 10 / 20 cta
    expect(aug2[H('SEO_QUAL_RATE')]).toBe(0.4); // 4 / 10 partial
    expect(aug2[H('SEO_CALL1_RATE')]).toBe(0.5); // 2 / 4 qualified
    expect(aug2[H('SEO_ACCEPT_RATE')]).toBe(0.5); // 1 / 2 booked
    expect(aug2[H('SEO_SESSION_TO_ACCEPTED')]).toBe(0.01); // 1 / 100 sessions
  });

  it('totals as a ratio of totals, not a mean of daily rates', () => {
    const [total] = toSeoFunnelValues(rows, '2026-01-01');

    expect(total[H('SEO_SESSIONS')]).toBe(200);
    expect(total[H('SEO_ACCEPTED')]).toBe(2);
    // Σ cta 30 ÷ Σ sessions 200 = 0.15 — NOT (0.2 + 0.1) / 2.
    expect(total[H('SEO_CTA_RATE')]).toBe(0.15);
  });

  it('carries other channels in the comparison block', () => {
    const [, aug2] = toSeoFunnelValues(rows, '2026-01-01');

    expect(aug2[H('FB_SESSIONS')]).toBe(900);
    expect(aug2[H('FB_CALL1_BOOKED')]).toBe(30);
    expect(aug2[H('FB_ACCEPTED')]).toBe(5);
    expect(H('FB_SESSIONS')).toBeGreaterThanOrEqual(SEO_FUNNEL_COMPARISON_START);
  });

  it('zero-fills a channel that had no activity that day', () => {
    const [, aug2] = toSeoFunnelValues(rows, '2026-01-01');

    expect(aug2[H('AI_SESSIONS')]).toBe(0);
    expect(aug2[H('AI_ACCEPTED')]).toBe(0);
  });

  it('never divides by zero', () => {
    const [total, day] = toSeoFunnelValues([row('2026-08-02', 'seo')], '2026-01-01');

    for (const cell of [...total.slice(1), ...day.slice(1)]) expect(cell).toBe(0);
  });

  it('drops days before the floor date', () => {
    const values = toSeoFunnelValues(rows, '2026-08-02');

    expect(values.map((v) => v[0])).toEqual(['Total', '2026-08-02']);
    expect(values[0][H('SEO_SESSIONS')]).toBe(100);
  });
});

describe('buildSeoFunnelFormatRequests', () => {
  it('freezes the header and Total row and shades the comparison block', () => {
    const requests = buildSeoFunnelFormatRequests(42, 3);
    const json = JSON.stringify(requests);

    expect(json).toContain('"frozenRowCount":2');
    expect(json).toContain('PERCENT');
    expect(
      requests.some(
        (r) =>
          (r as { repeatCell?: { range?: { startColumnIndex?: number } } }).repeatCell?.range
            ?.startColumnIndex === SEO_FUNNEL_COMPARISON_START
      )
    ).toBe(true);
  });
});
