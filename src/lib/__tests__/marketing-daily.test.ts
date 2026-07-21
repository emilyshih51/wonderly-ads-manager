import { describe, expect, it } from 'vitest';

import {
  bucketByChannel,
  channelForSource,
  checkStaleness,
  joinMarketingDaily,
  mergeRows,
  toSheetValues,
  type MarketingDailyRow,
} from '@/lib/marketing-daily';

describe('channelForSource', () => {
  it('folds facebook and ig into one channel', () => {
    // Both are Meta and both bill to the same ad account. If they were split,
    // spend would sit against one channel and bookings against two.
    expect(channelForSource('facebook')).toBe('fb');
    expect(channelForSource('ig')).toBe('fb');
  });

  it('treats unattributed and unknown sources as other', () => {
    expect(channelForSource('(none)')).toBe('other');
    expect(channelForSource('efficient.app')).toBe('other');
    expect(channelForSource('some-newsletter')).toBe('other');
  });

  it('is case insensitive', () => {
    expect(channelForSource('Facebook')).toBe('fb');
  });
});

describe('bucketByChannel', () => {
  it('sums facebook and ig into the same bucket', () => {
    const result = bucketByChannel([
      { date: '2026-07-16', utmSource: 'facebook', count: 17 },
      { date: '2026-07-16', utmSource: 'ig', count: 2 },
      { date: '2026-07-16', utmSource: '(none)', count: 3 },
    ]);

    expect(result['2026-07-16']).toEqual({ fb: 19, other: 3 });
  });
});

describe('joinMarketingDaily', () => {
  it('joins spend to bookings on date', () => {
    const rows = joinMarketingDaily(
      [{ date: '2026-07-16', spend: 4937.12, impressions: 57000, clicks: 1044 }],
      [{ date: '2026-07-16', utmSource: 'facebook', count: 19 }],
      [{ date: '2026-07-16', utmSource: 'facebook', count: 17 }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-07-16',
      fbSpend: 4937.12,
      fbClicks: 1044,
      fbQualified: 19,
      fbBooked: 17,
    });
  });

  it('keeps days with spend but no bookings', () => {
    // A day where we paid and got nothing is a real result, not missing data.
    const rows = joinMarketingDaily(
      [{ date: '2026-07-16', spend: 4937.12, impressions: 57000, clicks: 1044 }],
      [],
      []
    );

    expect(rows[0].fbBooked).toBe(0);
    expect(rows[0].fbSpend).toBe(4937.12);
  });

  it('keeps days with bookings but no spend', () => {
    // ~17% of bookings arrive with utm_source=(none) and no spend attached.
    const rows = joinMarketingDaily(
      [],
      [],
      [{ date: '2026-07-16', utmSource: '(none)', count: 3 }]
    );

    expect(rows[0].otherBooked).toBe(3);
    expect(rows[0].fbSpend).toBe(0);
  });

  it('sorts newest first to match the sheet', () => {
    const rows = joinMarketingDaily(
      [
        { date: '2026-07-14', spend: 1, impressions: 1, clicks: 1 },
        { date: '2026-07-16', spend: 2, impressions: 2, clicks: 2 },
        { date: '2026-07-15', spend: 3, impressions: 3, clicks: 3 },
      ],
      [],
      []
    );

    expect(rows.map((r) => r.date)).toEqual(['2026-07-16', '2026-07-15', '2026-07-14']);
  });
});

describe('mergeRows', () => {
  it('lets fresh rows win over existing ones', () => {
    // Meta restates spend for 24-48h. The refetched value is the truer one.
    const existing: MarketingDailyRow[] = [row('2026-07-16', { fbSpend: 4000 })];
    const fresh: MarketingDailyRow[] = [row('2026-07-16', { fbSpend: 4937.12 })];

    expect(mergeRows(existing, fresh)[0].fbSpend).toBe(4937.12);
  });

  it('preserves older rows outside the refetch window', () => {
    const existing: MarketingDailyRow[] = [row('2026-01-01', { fbSpend: 99 })];
    const fresh: MarketingDailyRow[] = [row('2026-07-16', { fbSpend: 4937.12 })];
    const merged = mergeRows(existing, fresh);

    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.date === '2026-01-01')?.fbSpend).toBe(99);
  });
});

describe('checkStaleness', () => {
  it('passes on fresh data', () => {
    const rows = [row('2026-07-17', { fbSpend: 4937 }), row('2026-07-16', { fbSpend: 5102 })];

    expect(checkStaleness(rows, '2026-07-17')).toBeNull();
  });

  it('flags data that has stopped arriving', () => {
    const rows = [row('2026-05-04', { fbSpend: 4937 })];

    expect(checkStaleness(rows, '2026-07-17')).toMatch(/stale/);
  });

  it('flags all-zero spend rather than reporting it as a business result', () => {
    // This is the exact failure Motion's sheet has had since 2026-04-06: the
    // Facebook connector died, every downstream layer reported success, and
    // FB_SPEND read $0 for three months without anyone noticing.
    const rows = [
      row('2026-07-17', { fbSpend: 0 }),
      row('2026-07-16', { fbSpend: 0 }),
      row('2026-07-15', { fbSpend: 0 }),
    ];

    expect(checkStaleness(rows, '2026-07-17')).toMatch(/\$0/);
  });

  it('flags an empty response', () => {
    expect(checkStaleness([], '2026-07-17')).toMatch(/no rows/);
  });
});

describe('toSheetValues', () => {
  it('emits columns in header order', () => {
    const values = toSheetValues([
      {
        date: '2026-07-16',
        fbSpend: 4937.12,
        fbImpressions: 57000,
        fbClicks: 1044,
        fbQualified: 19,
        fbBooked: 17,
        otherQualified: 4,
        otherBooked: 3,
      },
    ]);

    expect(values[0]).toEqual(['2026-07-16', 4937.12, 57000, 1044, 19, 17, 4, 3]);
  });
});

function row(date: string, overrides: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date,
    fbSpend: 0,
    fbImpressions: 0,
    fbClicks: 0,
    fbQualified: 0,
    fbBooked: 0,
    otherQualified: 0,
    otherBooked: 0,
    ...overrides,
  };
}
