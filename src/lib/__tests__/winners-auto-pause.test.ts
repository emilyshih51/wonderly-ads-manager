import { describe, it, expect } from 'vitest';

import {
  LADDER_CAPS,
  evaluateWinnersAd,
  groupDailyRowsByAd,
  todayInTimezone,
  toWinnersSlackMessage,
  trialsInLastSpend,
  type AdDay,
  type WinnersAdResult,
} from '@/lib/winners-auto-pause';
import type { MetaInsightsRow } from '@/types';

const TODAY = '2026-10-07';

/** One day of delivery, `n` days before TODAY. */
function day(daysAgo: number, spend: number, trials: number): AdDay {
  const d = new Date(`${TODAY}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() - daysAgo);

  return { date: d.toISOString().slice(0, 10), spend, trials };
}

describe('evaluateWinnersAd — Rule 3 (no pauses on day one)', () => {
  it('keeps Brad ADU on day one even with 1 trial on $1,268 (ladder cap would be $970)', () => {
    const verdict = evaluateWinnersAd([day(0, 1268, 1)], TODAY);

    expect(verdict).toMatchObject({ action: 'keep', reason: 'first_day' });
  });

  it('judges the ad once it has a day of delivery behind it', () => {
    const verdict = evaluateWinnersAd([day(1, 1268, 1), day(0, 100, 0)], TODAY);

    expect(verdict).toMatchObject({ action: 'pause', rule: 'ladder' });
  });

  it('keeps an ad that has never spent', () => {
    expect(evaluateWinnersAd([day(2, 0, 0)], TODAY)).toMatchObject({
      action: 'keep',
      reason: 'no_spend',
    });
  });
});

describe('evaluateWinnersAd — Rule 1 (ladder, 0–7 trials)', () => {
  it('matches the spec table', () => {
    expect([...LADDER_CAPS]).toEqual([575, 970, 1330, 1670, 2000, 2320, 2630, 2940]);
  });

  it.each(LADDER_CAPS.map((cap, trials) => [trials, cap]))(
    '%i trials: keeps at the $%i cap, pauses just over it',
    (trials, cap) => {
      expect(evaluateWinnersAd([day(3, cap, trials)], TODAY).action).toBe('keep');
      expect(evaluateWinnersAd([day(3, cap + 1, trials)], TODAY)).toMatchObject({
        action: 'pause',
        rule: 'ladder',
      });
    }
  );

  it('keeps Brad ADU at 2 trials on $1,268 (cap $1,330)', () => {
    expect(evaluateWinnersAd([day(1, 1268, 2)], TODAY).action).toBe('keep');
  });

  it('sums spend and trials across days', () => {
    const verdict = evaluateWinnersAd([day(3, 400, 0), day(2, 400, 1), day(1, 400, 1)], TODAY);

    // 2 trials on $1,200 — under the $1,330 cap.
    expect(verdict).toMatchObject({ action: 'keep', spend: 1200, trials: 2 });
  });

  it('explains the decision in plain language', () => {
    const verdict = evaluateWinnersAd([day(2, 1412, 2)], TODAY);

    expect(verdict.detail).toBe('2 trials on $1,412 — cap for 2 trials is $1,330');
  });
});

describe('evaluateWinnersAd — Rule 2 (fatigue, 8+ trials)', () => {
  // Early good days: 10 trials on $2,500 — total CPA looks fine on its own.
  const strongStart = [day(10, 1250, 5), day(9, 1250, 5)];

  it('pauses when the last $2k had 4 or fewer trials, even though total CPA looks fine', () => {
    // Total: 14 trials on $4,500 = $321 CPA — but the point is the recent window.
    const verdict = evaluateWinnersAd([...strongStart, day(2, 1000, 2), day(1, 1000, 2)], TODAY);

    expect(verdict).toMatchObject({ action: 'pause', rule: 'fatigue', windowTrials: 4 });
  });

  it('keeps when the last $2k had 5 or more trials', () => {
    const verdict = evaluateWinnersAd([...strongStart, day(2, 1000, 3), day(1, 1000, 2)], TODAY);

    expect(verdict).toMatchObject({ action: 'keep', reason: 'not_fatigued', windowTrials: 5 });
  });

  it('applies from exactly 8 trials', () => {
    const verdict = evaluateWinnersAd([day(5, 2400, 8), day(1, 2000, 0)], TODAY);

    expect(verdict).toMatchObject({ action: 'pause', rule: 'fatigue' });
  });

  it('counts a late-attributed trial on a $0-spend day', () => {
    // The newest day spent nothing but Meta attributed 1 trial to it — it still counts.
    const verdict = evaluateWinnersAd([...strongStart, day(2, 2000, 4), day(1, 0, 1)], TODAY);

    expect(verdict).toMatchObject({ action: 'keep', trials: 15, windowTrials: 5 });
  });

  it('keeps an 8+ trial ad that has spent under $2k in total', () => {
    expect(evaluateWinnersAd([day(2, 1800, 8)], TODAY)).toMatchObject({
      action: 'keep',
      reason: 'not_fatigued',
    });
  });
});

describe('trialsInLastSpend', () => {
  it('counts the boundary day proportionally so the window is exactly $2k', () => {
    // Newest: $1,500 / 3 trials, then $1,000 / 4 trials → only $500 of that day (half) fits.
    const days = [day(2, 1000, 4), day(1, 1500, 3)];

    expect(trialsInLastSpend(days)).toBe(5);
  });

  it('ignores order of input days', () => {
    const days = [day(1, 1500, 3), day(3, 5000, 50), day(2, 1000, 4)];

    expect(trialsInLastSpend(days)).toBe(5);
  });

  it('stops once the window is full', () => {
    expect(trialsInLastSpend([day(3, 1000, 9), day(2, 1000, 1), day(1, 1000, 1)])).toBe(2);
  });
});

describe('groupDailyRowsByAd', () => {
  function row(adId: string, date: string, spend: string, trials: number): MetaInsightsRow {
    return {
      ad_id: adId,
      ad_name: `Ad ${adId}`,
      spend,
      date_start: date,
      date_stop: date,
      actions: [
        { action_type: 'offsite_conversion.fb_pixel_start_trial', value: String(trials) },
        // Other events on the same row must not count as trials.
        { action_type: 'offsite_conversion.fb_pixel_complete_registration', value: '9' },
        { action_type: 'link_click', value: '40' },
      ],
    } as MetaInsightsRow;
  }

  it('groups per ad and counts only start_trial', () => {
    const ads = groupDailyRowsByAd([
      row('1', '2026-10-01', '100.50', 1),
      row('2', '2026-10-01', '200', 0),
      row('1', '2026-10-02', '50', 2),
    ]);

    expect(ads).toEqual([
      {
        adId: '1',
        adName: 'Ad 1',
        days: [
          { date: '2026-10-01', spend: 100.5, trials: 1 },
          { date: '2026-10-02', spend: 50, trials: 2 },
        ],
      },
      { adId: '2', adName: 'Ad 2', days: [{ date: '2026-10-01', spend: 200, trials: 0 }] },
    ]);
  });

  it('treats a row with no actions as 0 trials', () => {
    const [ad] = groupDailyRowsByAd([
      { ad_id: '1', spend: '10', date_start: '2026-10-01' } as MetaInsightsRow,
    ]);

    expect(ad.days[0].trials).toBe(0);
  });
});

describe('todayInTimezone', () => {
  it('uses the account timezone, not UTC', () => {
    // 03:00 UTC on Oct 8 is still Oct 7 in Los Angeles.
    const now = new Date('2026-10-08T03:00:00Z');

    expect(todayInTimezone('America/Los_Angeles', now)).toBe('2026-10-07');
    expect(todayInTimezone('UTC', now)).toBe('2026-10-08');
  });
});

describe('toWinnersSlackMessage', () => {
  const adLink = (id: string) => `https://ads.example/${id}`;
  const results: WinnersAdResult[] = [
    { adId: '1', adName: 'Bad Ad', verdict: evaluateWinnersAd([day(2, 700, 0)], TODAY) },
    { adId: '2', adName: 'Good Ad', verdict: evaluateWinnersAd([day(2, 500, 3)], TODAY) },
    { adId: '3', adName: 'New Ad', verdict: evaluateWinnersAd([day(0, 900, 0)], TODAY) },
  ];

  it('says "would pause" on a dry run and lists each flagged ad with its rule', () => {
    const text = toWinnersSlackMessage(results, { dryRun: true, adLink });

    expect(text).toContain('DRY RUN');
    expect(text).toContain('Would pause 1 of 2 active ads');
    expect(text).toContain(
      '<https://ads.example/1|Bad Ad> — Rule 1 (ladder): 0 trials on $700 — cap for 0 trials is $575'
    );
    expect(text).not.toContain('Good Ad');
    expect(text).toContain('1 ad(s) skipped on their first day');
  });

  it('flags a failed pause on a live run', () => {
    const live = results.map((r) => (r.adId === '1' ? { ...r, paused: false } : r));
    const text = toWinnersSlackMessage(live, { dryRun: false, adLink });

    expect(text).toContain('Paused 1 of 2');
    expect(text).toContain('pause failed');
  });

  it('says so when nothing failed', () => {
    const text = toWinnersSlackMessage([results[1]], { dryRun: true, adLink });

    expect(text).toContain('none failed the rules');
  });
});
