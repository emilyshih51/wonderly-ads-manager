import { describe, expect, it, vi } from 'vitest';

import {
  LINKEDIN_METRICS_HEADERS,
  joinLinkedinDays,
  toLinkedinMetricsValues,
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

  it('returns nothing when there is no activity at all', () => {
    expect(joinLinkedinDays([spendDay('2026-10-20', 0)], [])).toEqual([]);
  });
});

describe('toLinkedinMetricsValues', () => {
  it('writes summary rows with ratio-of-totals costs, then daily rows', () => {
    const days = joinLinkedinDays(
      [spendDay('2026-10-28', 300, 30), spendDay('2026-10-29', 100, 10)],
      [
        funnelDay('2026-10-28', { qualified: 3, call1Booked: 1, directBooked: 1 }),
        funnelDay('2026-10-29', { qualified: 1, accepted: 1 }),
      ]
    );
    const values = toLinkedinMetricsValues(days, '2026-10-30');
    const col = (name: string) => LINKEDIN_METRICS_HEADERS.indexOf(name as never);

    expect(values[0][0]).toBe('Since launch');
    expect(values[0][col('Spend')]).toBe(400);
    expect(values[0][col('CPC')]).toBe(10); // 400 / 40, not mean of daily CPCs
    expect(values[0][col('Cost / qualified')]).toBe(100); // 400 / 4
    expect(values[0][col('All booked')]).toBe(2);
    expect(values[0][col('Cost / booked')]).toBe(200);
    expect(values[0][col('Cost / accepted')]).toBe(400);
    expect(values[3]).toEqual([]); // spacer
    expect(values[4][0]).toBe('2026-10-29');
    expect(values[4][col('Cost / held')]).toBe(''); // blank, not divide-by-zero
  });

  it('excludes today from Last 7d', () => {
    const days = joinLinkedinDays([spendDay('2026-10-30', 999), spendDay('2026-10-29', 1)], []);
    const values = toLinkedinMetricsValues(days, '2026-10-30');

    expect(values[1][0]).toBe('Last 7d');
    expect(values[1][1]).toBe(1);
  });

  it('shows a placeholder row before launch', () => {
    expect(toLinkedinMetricsValues([], '2026-10-30')[0][0]).toMatch(/No LinkedIn activity/);
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
