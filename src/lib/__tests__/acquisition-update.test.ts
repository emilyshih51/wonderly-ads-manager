import { describe, expect, it } from 'vitest';

import {
  COHORT_LAG_DAYS,
  COHORT_WINDOW_DAYS,
  GOAL_COST_PER_SUCCEEDING,
  MIN_SUCCEEDING,
  addDays,
  cohortWindow,
  computeAcquisitionUpdate,
  toSlackSummary,
  windowTotals,
  type CampCohortCounts,
} from '@/lib/acquisition-update';
import type { MarketingDailyRow } from '@/lib/marketing-daily';

/** A daily row with only the fields this readout reads; everything else zeroed. */
function row(date: string, over: Partial<MarketingDailyRow> = {}): MarketingDailyRow {
  return {
    date,
    fbSpend: 0,
    fbImpressions: 0,
    fbClicks: 0,
    pageView: 0,
    pageViewFb: 0,
    pageViewOrganic: 0,
    ctaClicked: 0,
    ctaFb: 0,
    ctaOrganic: 0,
    submitPartial: 0,
    submitPartialFb: 0,
    submitPartialOrganic: 0,
    submitQualified: 0,
    submitQualifiedFb: 0,
    submitQualifiedOrganic: 0,
    bookedAll: 0,
    bookedFb: 0,
    bookedOrganic: 0,
    accepted: 0,
    acceptedFb: 0,
    acceptedOrganic: 0,
    noShow: 0,
    noShowFb: 0,
    noShowOrganic: 0,
    disqualifiedLost: 0,
    held: 0,
    heldFb: 0,
    heldOrganic: 0,
    ...over,
  };
}

const camp: CampCohortCounts = {
  accepted: 36,
  matchedToCamp: 27,
  launchedAds: 24,
  campSucceeding: 14,
  campOkayOrSucceeding: 16,
  wonAJob: 3,
  revshareBooked: 1,
  revshareCollected: 0,
};

describe('cohortWindow', () => {
  it('is a 3-week window lagged two weeks behind the run date', () => {
    const { start, end } = cohortWindow('2026-08-06');

    expect(end).toBe(addDays('2026-08-06', -COHORT_LAG_DAYS));
    expect(start).toBe(addDays(end, -COHORT_WINDOW_DAYS));
    expect(end).toBe('2026-07-23');
    expect(start).toBe('2026-07-02');
  });

  it('slides forward one day at a time', () => {
    const a = cohortWindow('2026-08-06');
    const b = cohortWindow('2026-08-07');

    expect(b.start).toBe(addDays(a.start, 1));
    expect(b.end).toBe(addDays(a.end, 1));
  });
});

describe('windowTotals', () => {
  const rows = [
    row('2026-07-01', { fbSpend: 100, bookedAll: 10, accepted: 1 }),
    row('2026-07-02', { fbSpend: 200, bookedAll: 20, accepted: 2 }),
    row('2026-07-03', { fbSpend: 400, bookedAll: 40, accepted: 4 }),
  ];

  it('includes the start date and excludes the end date', () => {
    const totals = windowTotals(rows, '2026-07-01', '2026-07-03');

    expect(totals.fbSpend).toBe(300);
    expect(totals.booked).toBe(30);
    expect(totals.accepted).toBe(3);
  });

  it('returns zeros for a window with no rows', () => {
    expect(windowTotals(rows, '2026-06-01', '2026-06-10').fbSpend).toBe(0);
  });

  it('ignores rows outside the window entirely', () => {
    expect(windowTotals(rows, '2026-07-03', '2026-07-04').fbSpend).toBe(400);
  });
});

describe('computeAcquisitionUpdate', () => {
  /** Cohort window 2026-07-02 … 2026-07-22 at $1,000/day = $21,000. */
  const cohortRows = Array.from({ length: COHORT_WINDOW_DAYS }, (_, i) =>
    row(addDays('2026-07-02', i), { fbSpend: 1000, bookedAll: 10, accepted: 1 })
  );

  const base = {
    today: '2026-08-06',
    rows: cohortRows,
    camp,
    cohortStart: '2026-07-02',
    cohortEnd: '2026-07-23',
  };

  it('divides cohort spend by CAMP-succeeding for the north-star metric', () => {
    const update = computeAcquisitionUpdate(base);

    expect(update.cohortSpend).toBe(21_000);
    expect(update.costPerSucceeding).toBe(Math.round(21_000 / 14));
    expect(update.costPerAccepted).toBe(Math.round(21_000 / 36));
  });

  it('flags whether the north-star metric is within goal', () => {
    expect(computeAcquisitionUpdate(base).meetsGoal).toBe(true);

    const expensive = computeAcquisitionUpdate({
      ...base,
      camp: { ...camp, campSucceeding: MIN_SUCCEEDING },
    });

    expect(expensive.costPerSucceeding).toBe(Math.round(21_000 / MIN_SUCCEEDING));
    expect(expensive.costPerSucceeding).toBeLessThan(GOAL_COST_PER_SUCCEEDING);
    expect(expensive.meetsGoal).toBe(true);
  });

  it('withholds a cost-per figure below the succeeding minimum', () => {
    const update = computeAcquisitionUpdate({
      ...base,
      camp: { ...camp, campSucceeding: MIN_SUCCEEDING - 1 },
    });

    expect(update.costPerSucceeding).toBeNull();
    expect(update.meetsGoal).toBe(false);
    expect(update.caveats[0]).toContain('once at least');
    expect(update.tables[0].rows[0][2]).toContain('maturing');
  });

  it('reports the match rate and always says the counts are a minimum', () => {
    const update = computeAcquisitionUpdate(base);

    expect(update.matchRate).toBeCloseTo(27 / 36);
    expect(update.caveats.join(' ')).toContain('minimum');
    expect(update.tables[1].rows[1][0]).toBe('Matched to a CAMP customer');
  });

  it('builds the four tables in readout order', () => {
    const titles = computeAcquisitionUpdate(base).tables.map((t) => t.title);

    expect(titles).toEqual([
      'What it costs us to find a contractor who works out',
      'How this group of contractors is doing',
      'What we spent last week to get contractors interested',
      "What happened to last week's booked calls — so far",
    ]);
  });

  it('explains the calculation and its sources next to the north-star number', () => {
    const northStar = computeAcquisitionUpdate(base).tables[0];

    expect(northStar.headers).toContain('How we work it out');
    expect(northStar.note).toContain('Facebook');
    expect(northStar.note).toContain('CAMP');

    // The explanation must show the actual arithmetic, not just name the inputs.
    const explanation = northStar.rows[0][northStar.headers.indexOf('How we work it out')];

    expect(explanation).toContain('$21,000');
    expect(explanation).toContain('14');
  });

  it('explains how the cohort window moves and why it lags', () => {
    const note = computeAcquisitionUpdate(base).tables[1].note ?? '';

    // Yesterday's and tomorrow's windows, so "why did this change?" answers itself.
    expect(note).toContain('2026-07-01');
    expect(note).toContain('2026-07-03');
    expect(note).toContain(`${COHORT_LAG_DAYS} days`);
  });

  it('names the exact dates each week-over-week column covers', () => {
    const headers = computeAcquisitionUpdate(base).tables[2].headers;

    expect(headers[1]).toContain('2026-07-30');
    expect(headers[1]).toContain('2026-08-05');
    expect(headers[2]).toContain('2026-07-23');
    expect(headers[2]).toContain('2026-07-29');
  });

  it('warns that last week&apos;s call outcomes are not settled yet', () => {
    const outcomes = computeAcquisitionUpdate(base).tables[3];

    expect(outcomes.note).toContain('have not happened yet');
  });

  it('avoids internal jargon in reader-facing copy', () => {
    const update = computeAcquisitionUpdate(base);

    const prose = [
      ...update.tables.map((t) => `${t.title} ${t.note ?? ''} ${t.headers.join(' ')}`),
      ...update.tables.flatMap((t) => t.rows.map((r) => r.join(' '))),
      ...update.caveats,
    ]
      .join(' ')
      .toLowerCase();

    // Terms a reader outside the growth team would not know. "CAMP" survives — it is the
    // name of an internal tool, and the copy explains what it is.
    for (const jargon of ['cohort', 'funnel', 'booking-day', 'attribution', 'denominator', 'roi']) {
      expect(prose).not.toContain(jargon);
    }
  });

  it('gives every table rows of exactly the header width', () => {
    for (const table of computeAcquisitionUpdate(base).tables) {
      for (const r of table.rows) {
        expect(r).toHaveLength(table.headers.length);
      }
    }
  });

  it('compares the last 7 completed days against the prior 7, excluding today', () => {
    const rows = [
      // Today — a partial day that must not be counted.
      row('2026-08-06', { fbSpend: 9999, bookedAll: 999 }),
      ...Array.from({ length: 7 }, (_, i) =>
        row(addDays('2026-07-30', i), { fbSpend: 100, bookedAll: 10 })
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        row(addDays('2026-07-23', i), { fbSpend: 50, bookedAll: 5 })
      ),
    ];

    const acquisition = computeAcquisitionUpdate({ ...base, rows }).tables[2];

    expect(acquisition.rows[0]).toEqual(['Money paid to Facebook', '$700', '$350', '+100%']);
    expect(acquisition.rows[1]).toEqual([
      'Contractors who booked a first call',
      '70',
      '35',
      '+100%',
    ]);
    expect(acquisition.rows[2]).toEqual(['What each booked call cost us', '$10', '$10', '+0%']);
  });

  it('handles an empty cohort without dividing by zero', () => {
    const update = computeAcquisitionUpdate({
      ...base,
      rows: [],
      camp: {
        accepted: 0,
        matchedToCamp: 0,
        launchedAds: 0,
        campSucceeding: 0,
        campOkayOrSucceeding: 0,
        wonAJob: 0,
        revshareBooked: 0,
        revshareCollected: 0,
      },
    });

    expect(update.costPerAccepted).toBeNull();
    expect(update.costPerSucceeding).toBeNull();
    expect(update.matchRate).toBe(0);
    expect(update.tables[2].rows[2][1]).toBe('—');
  });
});

describe('toSlackSummary', () => {
  it('leads with the cost per succeeding contractor and the goal verdict', () => {
    const update = computeAcquisitionUpdate({
      today: '2026-08-06',
      rows: Array.from({ length: COHORT_WINDOW_DAYS }, (_, i) =>
        row(addDays('2026-07-02', i), { fbSpend: 1000 })
      ),
      camp,
      cohortStart: '2026-07-02',
      cohortEnd: '2026-07-23',
    });

    const summary = toSlackSummary(update, 'https://notion.so/page');

    expect(summary).toContain('Growth — acquisition update · 2026-08-06');
    expect(summary).toContain('✅ under');
    expect(summary).toContain('https://notion.so/page');
    expect(summary).toContain('minimums');
    expect(summary).toContain('36 contractors');
    expect(summary).toContain('14 are doing well');
  });

  it('stays short enough to actually get read', () => {
    const update = computeAcquisitionUpdate({
      today: '2026-08-06',
      rows: Array.from({ length: COHORT_WINDOW_DAYS }, (_, i) =>
        row(addDays('2026-07-02', i), { fbSpend: 1000 })
      ),
      camp,
      cohortStart: '2026-07-02',
      cohortEnd: '2026-07-23',
    });

    expect(toSlackSummary(update, 'https://notion.so/page').split('\n')).toHaveLength(5);
  });

  it('explains why there is no number rather than printing a noisy one', () => {
    const update = computeAcquisitionUpdate({
      today: '2026-08-06',
      rows: [],
      camp: { ...camp, campSucceeding: 1 },
      cohortStart: '2026-07-02',
      cohortEnd: '2026-07-23',
    });

    expect(toSlackSummary(update)).toContain('too few to divide by');
  });
});
