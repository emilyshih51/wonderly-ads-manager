import { describe, expect, it, vi } from 'vitest';

import { MetaService, dateWindows, isMetaTransient } from '@/services/meta';
import { MetaApiError } from '@/services/meta/types';

describe('dateWindows', () => {
  it('splits a range into ≤31-day windows with no gaps', () => {
    expect(dateWindows('2026-07-01', '2026-09-15', 31)).toEqual([
      { since: '2026-07-01', until: '2026-07-31' },
      { since: '2026-08-01', until: '2026-08-31' },
      { since: '2026-09-01', until: '2026-09-15' },
    ]);
  });

  it('handles a single day', () => {
    expect(dateWindows('2026-10-01', '2026-10-01', 31)).toEqual([
      { since: '2026-10-01', until: '2026-10-01' },
    ]);
  });
});

describe('isMetaTransient', () => {
  it('flags "Service temporarily unavailable" and unknown errors, not rate limits', () => {
    expect(
      isMetaTransient(new MetaApiError({ message: 'Service temporarily unavailable', code: 2 }))
    ).toBe(true);
    expect(
      isMetaTransient(new MetaApiError({ message: 'An unknown error occurred', code: 1 }))
    ).toBe(true);
    expect(
      isMetaTransient(new MetaApiError({ message: 'User request limit reached', code: 17 }))
    ).toBe(false);
  });
});

describe('getCampaignAdDailyInsights', () => {
  const ok = (data: unknown[]) => ({ json: async () => ({ data }) });

  it('batches ads, splits dates, and retries a transient error', async () => {
    vi.useFakeTimers();

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ error: { message: 'Service temporarily unavailable', code: 2 } }),
      })
      .mockResolvedValue(ok([{ ad_id: '1', spend: '10' }]));
    const meta = new MetaService('t', 'acct', fetchFn as unknown as typeof fetch);
    const ids = Array.from({ length: 60 }, (_, i) => String(i));

    const promise = meta.getCampaignAdDailyInsights('c', '2026-08-01', '2026-09-15', ids);

    await vi.runAllTimersAsync();
    const rows = await promise;

    // 2 date windows × 2 ad batches = 4 requests, plus 1 retry
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(rows).toHaveLength(4);

    const firstUrl = new URL(fetchFn.mock.calls[1][0]);

    expect(JSON.parse(firstUrl.searchParams.get('filtering')!)[0].value).toHaveLength(50);
    vi.useRealTimers();
  });

  it('returns nothing without calling Meta when there are no active ads', async () => {
    const fetchFn = vi.fn();
    const meta = new MetaService('t', 'acct', fetchFn as unknown as typeof fetch);

    expect(await meta.getCampaignAdDailyInsights('c', '2026-08-01', '2026-09-15', [])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
