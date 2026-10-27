import { describe, expect, it, vi } from 'vitest';

import { buildDailyMetricsFormatRequests } from '@/lib/daily-metrics-format';
import {
  LINKEDIN_DAILY_METRICS_FORMAT,
  computeLinkedinDailyMetrics,
  joinLinkedinDays,
  type LinkedinFunnelRow,
} from '@/lib/linkedin-metrics';
import {
  LinkedInAdsService,
  parseDailyAnalytics,
  toRestliDate,
  type LinkedInDailySpend,
} from '@/services/linkedin';

vi.mock('@/lib/redis', () => ({ getRedisClient: async () => null }));

const spendDay = (date: string, spend: number, clicks = 10): LinkedInDailySpend => ({
  date,
  spend,
  impressions: spend > 0 ? 1000 : 0,
  clicks: clicks + 2,
  landingPageClicks: clicks,
  engagements: 30,
});

const funnelDay = (date: string, over: Partial<LinkedinFunnelRow> = {}): LinkedinFunnelRow => ({
  date,
  formOpened: 0,
  partial: 0,
  qualified: 0,
  call1Booked: 0,
  directBooked: 0,
  held: 0,
  noShow: 0,
  accepted: 0,
  ...over,
});

describe('joinLinkedinDays', () => {
  it('joins spend and funnel on date, newest first', () => {
    const days = joinLinkedinDays(
      [spendDay('2026-10-28', 100), spendDay('2026-10-29', 50)],
      [funnelDay('2026-10-29', { formOpened: 5, qualified: 2 })]
    );

    expect(days.map((d) => d.date)).toEqual(['2026-10-29', '2026-10-28']);
    expect(days[0]).toMatchObject({ spend: 50, clicks: 10, formOpened: 5, qualified: 2 });
    expect(days[1]).toMatchObject({ spend: 100, formOpened: 0 });
  });

  it('drops empty days before the first LinkedIn activity', () => {
    const days = joinLinkedinDays(
      [spendDay('2026-10-20', 0), spendDay('2026-10-21', 0), spendDay('2026-10-22', 40)],
      []
    );

    expect(days.map((d) => d.date)).toEqual(['2026-10-22']);
  });

  it('fills no-delivery days with zero rows so w/w stays aligned', () => {
    const days = joinLinkedinDays([spendDay('2026-10-20', 10), spendDay('2026-10-23', 10)], []);

    expect(days.map((d) => d.date)).toEqual([
      '2026-10-23',
      '2026-10-22',
      '2026-10-21',
      '2026-10-20',
    ]);
    expect(days[1].spend).toBe(0);
  });

  it('returns nothing when there is no activity at all', () => {
    expect(joinLinkedinDays([spendDay('2026-10-20', 0)], [])).toEqual([]);
  });
});

describe('computeLinkedinDailyMetrics', () => {
  // Two weeks of data: Mon 10/19 .. Thu 10/29 (no 10/24-10/25 weekend gap needed).
  const dates = [
    '2026-10-29',
    '2026-10-28',
    '2026-10-27',
    '2026-10-26',
    '2026-10-23',
    '2026-10-22',
  ];
  const days = joinLinkedinDays(
    dates.map((d) => spendDay(d, 100, 10)),
    [funnelDay('2026-10-28', { qualified: 4, call1Booked: 2, directBooked: 1, accepted: 1 })]
  );
  const m = computeLinkedinDailyMetrics(days, '2026-10-29');
  const header = m[0];
  const sub = m[1];

  const col = (label: string, subLabel: string) => {
    const g = header.indexOf(label);

    return sub.indexOf(subLabel, g);
  };

  it('uses the Daily Metrics shape: 2 header rows, 3 formula summary rows, then data', () => {
    expect(sub[0]).toBe('Date');
    expect([m[2][0], m[3][0], m[4][0]]).toEqual(['7d avg', 'MTD', 'Prev Month']);
    expect(String(m[3][col('Spend', 'ALL')])).toMatch(/^=SUMIFS\(/);
    expect(m[5][0]).toBe('2026-10-29');
  });

  it('closes each ISO week with a "Week of" row', () => {
    const labels = m.slice(5).map((r) => String(r[0]));

    expect(labels).toEqual([
      '2026-10-29',
      '2026-10-28',
      '2026-10-27',
      '2026-10-26',
      'Week of 2026-10-26',
      '2026-10-25',
      '2026-10-24',
      '2026-10-23',
      '2026-10-22',
      'Week of 2026-10-19',
    ]);
  });

  it('writes daily Cost = spend ÷ that stage, blank on zero days', () => {
    const row = m[6]; // 2026-10-28

    expect(row[col('Booked', 'Cost')]).toBe(33.33); // 100 / (2 form + 1 direct)
    expect(row[col('Booked', 'ALL')]).toBe(3);
    expect(row[col('Accepted', 'Cost')]).toBe(100);
    expect(m[5][col('Accepted', 'Cost')]).toBe('');
    expect(row[col('CPC', 'ALL')]).toBe(10);
  });

  it('drops the form-only steps (Partial / Qualified / Call 1 booked)', () => {
    expect(header).not.toContain('Qualified');
    expect(header).not.toContain('Partial');
    expect(header).not.toContain('Call 1 booked');
    expect(header).toContain('Landed');
  });

  it('weekly rows sum counts and use ratio of totals', () => {
    const week = m[9]; // Week of 2026-10-26

    expect(week[col('Spend', 'ALL')]).toBe(400);
    expect(week[col('Booked', 'Cost')]).toBe(133.33); // 400 / 3
    expect(week[col('CPC', 'ALL')]).toBe(10); // 400 / 40
  });

  it('every row is exactly as wide as the shared formatter expects', () => {
    const width =
      1 +
      LINKEDIN_DAILY_METRICS_FORMAT.reduce(
        (n, f) => n + 4 + (f.hasCost ? 1 : 0) - (f.noWow ? 1 : 0),
        0
      );

    for (const row of m) expect(row).toHaveLength(width);
    expect(() =>
      buildDailyMetricsFormatRequests(1, LINKEDIN_DAILY_METRICS_FORMAT, [], m)
    ).not.toThrow();
  });

  it('still writes headers + summary rows before launch', () => {
    const empty = computeLinkedinDailyMetrics([], '2026-10-29');

    expect(empty).toHaveLength(5);
    expect(String(empty[3][1])).toContain('$A$6:$A$6');
  });
});

describe('LinkedIn API parsing', () => {
  it('formats Rest.li dates', () => {
    expect(toRestliDate('2026-10-07')).toBe('(year:2026,month:10,day:7)');
  });

  it('parses adAnalytics elements (string cost) into sorted daily rows', () => {
    const rows = parseDailyAnalytics([
      {
        dateRange: { start: { year: 2026, month: 11, day: 2 } },
        costInLocalCurrency: '12.345',
        impressions: 500,
        clicks: 9,
        landingPageClicks: 7,
        totalEngagements: 20,
      },
      { dateRange: { start: { year: 2026, month: 11, day: 1 } }, costInLocalCurrency: '3' },
    ]);

    expect(rows).toEqual([
      {
        date: '2026-11-01',
        spend: 3,
        impressions: 0,
        clicks: 0,
        landingPageClicks: 0,
        engagements: 0,
      },
      {
        date: '2026-11-02',
        spend: 12.35,
        impressions: 500,
        clicks: 9,
        landingPageClicks: 7,
        engagements: 20,
      },
    ]);
  });

  it('builds a Rest.li query with an encoded account URN and refreshes once on 401', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);

      calls.push(u);

      if (u.includes('oauth')) {
        return new Response(JSON.stringify({ access_token: 'new', expires_in: 5000000 }));
      }

      if (calls.filter((c) => c.includes('adAnalytics')).length === 1) {
        return new Response('expired', { status: 401 });
      }

      return new Response(JSON.stringify({ elements: [] }));
    }) as unknown as typeof fetch;

    const svc = new LinkedInAdsService(
      'old',
      '557324947',
      { refreshToken: 'r', clientId: 'c', clientSecret: 's' },
      '202609',
      fetchFn
    );

    await expect(svc.getDailySpendForDateRange('2026-10-16', '2026-10-30')).resolves.toEqual([]);
    expect(calls[0]).toContain('accounts=List(urn%3Ali%3AsponsoredAccount%3A557324947)');
    expect(calls[0]).toContain(
      'dateRange=(start:(year:2026,month:10,day:16),end:(year:2026,month:10,day:30))'
    );
    expect(calls[1]).toContain('oauth/v2/accessToken');
    expect(calls).toHaveLength(3);
  });
});
