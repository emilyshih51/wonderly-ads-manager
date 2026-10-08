import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUTOPAUSE_SETTINGS as S,
  evaluateAd,
  formatSlackSummary,
  lastWindow,
  pGood,
  planRun,
  rule1Cap,
  rule2Line,
  sanitizeSettings,
  type AdDay,
} from '@/lib/winners-autopause';

/** Spread `spend`/`trials` evenly over `n` days ending 2026-10-06. */
function days(n: number, spendPerDay: number, trialsByDay: number[] = []): AdDay[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 6 - (n - 1 - i)));

    return {
      date: d.toISOString().slice(0, 10),
      spend: spendPerDay,
      trials: trialsByDay[i] ?? 0,
    };
  });
}

describe('pGood', () => {
  it('matches POISSON.DIST', () => {
    expect(pGood(4, 2000, 250)).toBeCloseTo(0.0996, 3);
    expect(pGood(5, 2000, 250)).toBeCloseTo(0.1912, 3);
    expect(pGood(0, 575, 250)).toBeCloseTo(0.1003, 3);
  });

  it('is 1 with no spend', () => {
    expect(pGood(0, 0, 250)).toBe(1);
  });
});

describe('rule1Cap — the ladder in the spec', () => {
  const ladder: Array<[number, number]> = [
    [0, 575],
    [1, 970],
    [2, 1330],
    [3, 1670],
    [4, 2000],
    [5, 2320],
    [8, 3250],
  ];

  for (const [trials, cap] of ladder) {
    it(`${trials} trials → ~$${cap}`, () => {
      expect(Math.abs(rule1Cap(trials, 250, 0.1) - cap)).toBeLessThanOrEqual(10);
    });
  }
});

describe('rule2Line', () => {
  it('is 4 trials for $2k at $250 / 10%', () => {
    expect(rule2Line(2000, 250, 0.1)).toBe(4);
  });

  it('is 5 at the 20% watch line', () => {
    expect(rule2Line(2000, 250, 0.2)).toBe(5);
  });
});

describe('lastWindow', () => {
  it('prorates the oldest day so the window is exactly $2k', () => {
    // newest → oldest: $900 (1), $900 (2), $900 (3). Window takes 1 + 2 + 3 × (200/900).
    const d: AdDay[] = [
      { date: '2026-10-04', spend: 900, trials: 3 },
      { date: '2026-10-05', spend: 900, trials: 2 },
      { date: '2026-10-06', spend: 900, trials: 1 },
    ];
    const w = lastWindow(d, 2000)!;

    expect(w.spend).toBe(2000);
    expect(w.trials).toBeCloseTo(3.7, 1);
  });

  it('is null before the ad has spent the window', () => {
    expect(lastWindow(days(3, 500), 2000)).toBeNull();
  });
});

describe('evaluateAd', () => {
  const ad = (d: AdDay[]) => ({ adId: '1', adName: 'Test ad', days: d });

  it('Rule 3: never pauses on day one', () => {
    const e = evaluateAd(ad(days(1, 1500)), S);

    expect(e.decision).toBe('TOO_EARLY');
  });

  it('Rule 1: 2 trials at $1,400 → pause', () => {
    const e = evaluateAd(ad(days(2, 700, [1, 1])), S);

    expect(e.decision).toBe('PAUSE');
    expect(e.rule).toBe('rule1');
  });

  it('Rule 1: 2 trials at $1,200 → watch (close to the $1,330 cap)', () => {
    const e = evaluateAd(ad(days(2, 600, [1, 1])), S);

    expect(e.decision).toBe('WATCH');
  });

  it('Rule 2: great early, 4 trials in the last $2k → pause (Brad ADU case)', () => {
    // 20 days at $500: first 16 days 2 trials/day (32 trials), last 4 days 1/day (4 trials).
    const trials = [...Array(16).fill(2), 1, 1, 1, 1];
    const e = evaluateAd(ad(days(20, 500, trials)), S);

    expect(e.rule1P).toBeGreaterThan(0.1); // total CPA still looks fine
    expect(e.rule2?.trials).toBe(4);
    expect(e.decision).toBe('PAUSE');
    expect(e.rule).toBe('rule2');
  });

  it('Rule 2: 4.3 trials in the last $2k → not paused (Ale Mediocrity case)', () => {
    // Last $2k = 4 × $500 days with 1 trial each + nothing else; add 0.3 via a $1,000 day.
    const d: AdDay[] = [
      ...days(16, 500, Array(16).fill(2)).map((x, i) => ({
        ...x,
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      })),
      { date: '2026-10-01', spend: 1000, trials: 1 }, // oldest in window, 30% used → 0.3
      { date: '2026-10-02', spend: 350, trials: 1 },
      { date: '2026-10-03', spend: 350, trials: 1 },
      { date: '2026-10-04', spend: 400, trials: 1 },
      { date: '2026-10-05', spend: 600, trials: 1 },
    ];
    const e = evaluateAd(ad(d), S);

    expect(e.rule2?.trials).toBeCloseTo(4.3, 1);
    expect(e.decision).toBe('WATCH');
  });

  it('Rule 2 does not apply under 8 lifetime trials', () => {
    const e = evaluateAd(ad(days(6, 400, [2, 2, 1, 1, 0, 0])), S);

    expect(e.rule2).toBeNull();
  });

  it('a healthy ad is OK', () => {
    const e = evaluateAd(ad(days(10, 500, Array(10).fill(2))), S);

    expect(e.decision).toBe('OK');
  });
});

describe('planRun', () => {
  const failing = (id: string) => ({ adId: id, adName: id, days: days(3, 1000) });

  it('pauses failing ads up to the limit', () => {
    const { toPause, overLimit } = planRun([failing('a'), failing('b')], S);

    expect(overLimit).toBe(false);
    expect(toPause.map((e) => e.adId)).toEqual(['a', 'b']);
  });

  it('pauses nothing when more ads fail than maxPausesPerRun', () => {
    const ads = ['a', 'b', 'c', 'd', 'e', 'f'].map(failing);
    const { toPause, overLimit } = planRun(ads, S);

    expect(overLimit).toBe(true);
    expect(toPause).toHaveLength(0);
  });
});

describe('sanitizeSettings', () => {
  it('defaults to on + dry run', () => {
    const s = sanitizeSettings(null);

    expect(s.enabled).toBe(true);
    expect(s.dryRun).toBe(true);
  });

  it('clamps nonsense', () => {
    const s = sanitizeSettings({ cutoff: 5, targetCpa: -1, maxPausesPerRun: Number.NaN });

    expect(s.cutoff).toBe(0.5);
    expect(s.targetCpa).toBe(50);
    expect(s.maxPausesPerRun).toBe(5);
  });
});

describe('formatSlackSummary', () => {
  it('says "Would pause" in dry run', () => {
    const { evaluations } = planRun([{ adId: 'a', adName: 'Ad A', days: days(3, 1000) }], S);
    const text = formatSlackSummary({
      ranAt: '',
      throughDate: '2026-10-06',
      settings: S,
      evaluations,
      paused: [],
      overLimit: false,
    });

    expect(text).toContain('dry run');
    expect(text).toContain('Would pause (1)');
    expect(text).toContain('Ad A');
  });
});
