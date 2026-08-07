/**
 * The daily "Growth — acquisition update" readout.
 *
 * Reproduces the four-table growth readout from the *Cost per Succeeding Contractor* spec,
 * refreshed every morning instead of hand-assembled. It joins the two halves of the story:
 *
 * - **Acquisition side** (this repo's existing Growth data): Facebook spend, Call 1s booked,
 *   held, accepted, no-show — the same `MarketingDailyRow`s the sheet and MCP already serve.
 * - **CAMP side** (`SnowflakeService.getCampCohort`): of the contractors we accepted in a
 *   window, how many CAMP now classifies as Succeeding, how many won a job, and how much
 *   revenue share is booked vs actually collected.
 *
 * ## The cohort is rolling and lagged
 *
 * Each run measures contractors accepted in `[T − 35d, T − 14d)` — a 3-week window, held back
 * 14 days. The lag matters: a booking-day cohort needs weeks to finish converting, so a window
 * ending today would always understate acceptance and overstate cost. The window slides daily,
 * so the number stays comparable run to run.
 *
 * ## Two honest caveats, carried in the output
 *
 * 1. **Not every accepted contractor can be scored.** The acquisition CRM and CAMP share no id;
 *    they join on contractor email, which lands ~75%. The misses are contractors with no
 *    Wonderly account at all, so every CAMP count here is a **floor**, never a ceiling. The
 *    match rate ships with the readout rather than being quietly absorbed.
 * 2. **This does not reproduce the 2026-08-06 hand-built readout.** That one reported ~$78,900
 *    of acquisition cost against a July 1–21 cohort; actual Facebook spend across those days is
 *    $112,667, so its per-contractor attribution could not be reconstructed from Meta or
 *    Snowflake. This uses **total Facebook spend over the cohort window**, which is reproducible
 *    and matches how `historical_cac` already computes CAC.
 */

import type { MarketingDailyRow } from '@/lib/marketing-daily';

/** The north-star target: spend no more than this to acquire one succeeding contractor. */
export const GOAL_COST_PER_SUCCEEDING = 10_000;

/** Cohort window length in days (3 weeks). */
export const COHORT_WINDOW_DAYS = 21;

/**
 * Days to hold the window back from today, so the booking-day cohort has had time to convert.
 * Below roughly two weeks the acceptance count is still climbing and the cost reads high.
 */
export const COHORT_LAG_DAYS = 14;

/**
 * Minimum succeeding contractors before a cost-per figure is trustworthy. Below this the
 * denominator is too small to divide into and the readout says so instead of printing a number.
 */
export const MIN_SUCCEEDING = 5;

/** CAMP-side counts for one accepted cohort. Every count is scoped to `matchedToCamp`. */
export interface CampCohortCounts {
  /** Acquisition-side deals accepted in the window — the cohort size. */
  accepted: number;
  /** How many of those joined to a CAMP team. The rest cannot be scored at all. */
  matchedToCamp: number;
  /** Matched contractors whose ads have a first-run date. */
  launchedAds: number;
  /** Matched contractors ever classified `Succeeding` in any lifecycle week. */
  campSucceeding: number;
  /** Matched contractors ever classified `Succeeding` or `Okay`. */
  campOkayOrSucceeding: number;
  /** Matched contractors with at least one won job. */
  wonAJob: number;
  /** Matched contractors with revenue share booked (recorded, not yet cash). */
  revshareBooked: number;
  /** Matched contractors with revenue share collected (real cash in the bank). */
  revshareCollected: number;
}

export interface AcquisitionUpdateInput {
  /** Run date, `YYYY-MM-DD`. */
  today: string;
  /** Daily funnel + spend rows, newest first (as `fetchGrowthData` returns them). */
  rows: MarketingDailyRow[];
  /** CAMP counts for the cohort window below. */
  camp: CampCohortCounts;
  /** Cohort window start, inclusive, `YYYY-MM-DD`. */
  cohortStart: string;
  /** Cohort window end, **exclusive**, `YYYY-MM-DD`. */
  cohortEnd: string;
}

/** A rendered table: a header row plus body rows, all cells already strings. */
export interface ReadoutTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface AcquisitionUpdate {
  today: string;
  cohortStart: string;
  /** Exclusive end. `cohortLabel` renders the inclusive form for humans. */
  cohortEnd: string;
  /** Human-readable cohort description, e.g. `accepted Jul 2 – Jul 22`. */
  cohortLabel: string;
  /** Facebook spend across the cohort window. */
  cohortSpend: number;
  /** Cohort spend ÷ accepted, or null when the cohort is empty. */
  costPerAccepted: number | null;
  /** Cohort spend ÷ CAMP-succeeding, or null below `MIN_SUCCEEDING`. */
  costPerSucceeding: number | null;
  /** True when `costPerSucceeding` is non-null and within goal. */
  meetsGoal: boolean;
  /** `matchedToCamp / accepted`, 0–1. */
  matchRate: number;
  /** The CAMP counts this readout was built from, carried through for summaries. */
  camp: CampCohortCounts;
  tables: ReadoutTable[];
  /** Caveats that must ship with the numbers. */
  caveats: string[];
}

/** Add whole days to a `YYYY-MM-DD` date (UTC). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The rolling, lagged cohort window for a run date.
 *
 * @param today - Run date, `YYYY-MM-DD`
 * @returns Window start (inclusive) and end (exclusive)
 */
export function cohortWindow(today: string): { start: string; end: string } {
  const end = addDays(today, -COHORT_LAG_DAYS);

  return { start: addDays(end, -COHORT_WINDOW_DAYS), end };
}

/** Totals over a half-open date window `[start, end)`. */
export interface WindowTotals {
  fbSpend: number;
  booked: number;
  held: number;
  accepted: number;
  noShow: number;
  disqualifiedLost: number;
}

/**
 * Sum the funnel over a half-open date window.
 *
 * @param rows - Daily rows in any order
 * @param start - Window start, inclusive
 * @param end - Window end, exclusive
 */
export function windowTotals(rows: MarketingDailyRow[], start: string, end: string): WindowTotals {
  const totals: WindowTotals = {
    fbSpend: 0,
    booked: 0,
    held: 0,
    accepted: 0,
    noShow: 0,
    disqualifiedLost: 0,
  };

  for (const r of rows) {
    if (r.date < start || r.date >= end) continue;

    totals.fbSpend += r.fbSpend;
    totals.booked += r.bookedAll;
    totals.held += r.held;
    totals.accepted += r.accepted;
    totals.noShow += r.noShow;
    totals.disqualifiedLost += r.disqualifiedLost;
  }

  totals.fbSpend = Math.round(totals.fbSpend * 100) / 100;

  return totals;
}

/** `$1,234` — whole dollars, the readout's convention. */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** `43%` — a 0–1 ratio as a whole percent. */
function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Signed percent change between two numbers, e.g. `+3%`, `−2%`, or `—` when undefined. */
function wowChange(current: number, previous: number): string {
  if (previous === 0) return '—';

  const change = Math.round(((current - previous) / previous) * 100);

  return `${change >= 0 ? '+' : '−'}${Math.abs(change)}%`;
}

/** `Jul 2 – Jul 22` from a half-open window. */
function cohortLabelFor(start: string, endExclusive: string): string {
  const fmt = (iso: string): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });

  return `accepted ${fmt(start)} – ${fmt(addDays(endExclusive, -1))}`;
}

/** Share of the cohort, guarding a zero denominator. */
function shareOf(count: number, total: number): string {
  return total > 0 ? pct(count / total) : '—';
}

/**
 * Build the full readout: four tables, the headline economics, and the caveats.
 *
 * @param input - Run date, daily rows, CAMP counts, and the cohort window
 */
export function computeAcquisitionUpdate(input: AcquisitionUpdateInput): AcquisitionUpdate {
  const { today, rows, camp, cohortStart, cohortEnd } = input;

  const cohort = windowTotals(rows, cohortStart, cohortEnd);
  const cohortSpend = cohort.fbSpend;

  // The last 7 *completed* days — today's row is a partial and would drag every rate down.
  const last7End = today;
  const last7Start = addDays(last7End, -7);
  const prev7Start = addDays(last7Start, -7);

  const last7 = windowTotals(rows, last7Start, last7End);
  const prev7 = windowTotals(rows, prev7Start, last7Start);

  const costPerAccepted = camp.accepted > 0 ? Math.round(cohortSpend / camp.accepted) : null;
  const costPerSucceeding =
    camp.campSucceeding >= MIN_SUCCEEDING ? Math.round(cohortSpend / camp.campSucceeding) : null;

  const matchRate = camp.accepted > 0 ? camp.matchedToCamp / camp.accepted : 0;
  const cohortLabel = cohortLabelFor(cohortStart, cohortEnd);

  const succeedingCell =
    costPerSucceeding === null
      ? `maturing — ${camp.campSucceeding}/${camp.matchedToCamp} scored succeeding`
      : usd(costPerSucceeding);

  const northStar: ReadoutTable = {
    title: 'North-star metric',
    headers: ['North-star metric', 'Exact cohort', 'Current', 'Goal', 'Readout'],
    rows: [
      [
        'Estimated cost per CAMP-succeeding contractor',
        `${camp.accepted} contractors ${cohortLabel}; CAMP checked ${today}`,
        succeedingCell,
        `≤ ${usd(GOAL_COST_PER_SUCCEEDING)}`,
        `${usd(cohortSpend)} acquisition cost ÷ ${camp.campSucceeding} CAMP-Succeeding`,
      ],
      [
        'Cost per accepted contractor',
        `Same ${camp.accepted} contractors`,
        costPerAccepted === null ? '—' : usd(costPerAccepted),
        'Input to north-star cost',
        `${usd(cohortSpend)} ÷ ${camp.accepted} accepted`,
      ],
      [
        'Strictly verified succeeding contractors',
        `Same ${camp.accepted} contractors`,
        '0',
        'Consistently generates $100K/month at ≥1.5× ROI',
        `The ${camp.campSucceeding} CAMP-Succeeding customers have promising pipeline, but not yet proven economics`,
      ],
    ],
  };

  const launched = camp.launchedAds;

  /** Conversion against launched — the honest denominator once ads are the gate. */
  const ofLaunched = (n: number): string =>
    launched > 0 ? `${pct(n / launched)} of launched` : '—';

  const stages: ReadoutTable = {
    title: 'Cohort stage funnel',
    headers: [
      `${cohortLabel} cohort stage`,
      'Contractors',
      '% of accepted',
      'Relevant conversion',
      'What it means',
    ],
    rows: [
      ['Accepted', `${camp.accepted}`, '100%', '—', 'Starting cohort'],
      [
        'Matched to a CAMP customer',
        `${camp.matchedToCamp}`,
        shareOf(camp.matchedToCamp, camp.accepted),
        `${pct(matchRate)} of accepted`,
        'Unmatched contractors have no Wonderly account — every count below is a floor',
      ],
      [
        'Confirmed started ads',
        `${launched}`,
        shareOf(launched, camp.accepted),
        `${shareOf(launched, camp.matchedToCamp)} of matched`,
        `${camp.matchedToCamp - launched} matched but not confirmed launched`,
      ],
      [
        'CAMP Succeeding',
        `${camp.campSucceeding}`,
        shareOf(camp.campSucceeding, camp.accepted),
        ofLaunched(camp.campSucceeding),
        'Promising pipeline; not yet strict success',
      ],
      [
        'CAMP Okay or Succeeding',
        `${camp.campOkayOrSucceeding}`,
        shareOf(camp.campOkayOrSucceeding, camp.accepted),
        ofLaunched(camp.campOkayOrSucceeding),
        'Broader healthy-path measure',
      ],
      [
        'At least one job won',
        `${camp.wonAJob}`,
        shareOf(camp.wonAJob, camp.accepted),
        ofLaunched(camp.wonAJob),
        'Early customer revenue outcome',
      ],
      [
        'Revenue share booked',
        `${camp.revshareBooked}`,
        shareOf(camp.revshareBooked, camp.accepted),
        ofLaunched(camp.revshareBooked),
        'Wonderly revenue recorded, not collected',
      ],
      [
        'Revenue share collected',
        `${camp.revshareCollected}`,
        shareOf(camp.revshareCollected, camp.accepted),
        ofLaunched(camp.revshareCollected),
        camp.revshareCollected === 0 ? 'No collected proof yet' : 'Real cash in the bank',
      ],
    ],
  };

  const costPerCall1 = (t: WindowTotals): number | null =>
    t.booked > 0 ? Math.round(t.fbSpend / t.booked) : null;

  const last7Cpc = costPerCall1(last7);
  const prev7Cpc = costPerCall1(prev7);

  const acquisition: ReadoutTable = {
    title: 'Acquisition metrics, week over week',
    headers: ['Acquisition metric', 'Last 7 days', 'Previous week', 'WoW change'],
    rows: [
      [
        'Meta spend',
        usd(last7.fbSpend),
        usd(prev7.fbSpend),
        wowChange(last7.fbSpend, prev7.fbSpend),
      ],
      [
        'Call 1s booked',
        `${last7.booked}`,
        `${prev7.booked}`,
        wowChange(last7.booked, prev7.booked),
      ],
      [
        'Cost per Call 1 booked',
        last7Cpc === null ? '—' : usd(last7Cpc),
        prev7Cpc === null ? '—' : usd(prev7Cpc),
        last7Cpc === null || prev7Cpc === null ? '—' : wowChange(last7Cpc, prev7Cpc),
      ],
    ],
  };

  /** Outcome row: count, share of that window's bookings, and the prior window's share. */
  const outcomeRow = (
    label: string,
    current: number,
    previous: number,
    interpretation: string
  ): string[] => [
    label,
    `${current}`,
    shareOf(current, last7.booked),
    shareOf(previous, prev7.booked),
    interpretation,
  ];

  const outcomes: ReadoutTable = {
    title: 'Call 1 outcomes',
    headers: [
      `Call 1 outcome ${last7Start} – ${addDays(last7End, -1)}`,
      'Current count',
      'Current rate',
      `Previous period (${prev7Start} – ${addDays(last7Start, -1)})`,
      'Interpretation',
    ],
    rows: [
      outcomeRow('Call 1s booked', last7.booked, prev7.booked, 'Cohort denominator'),
      outcomeRow(
        'Held',
        last7.held,
        prev7.held,
        'The call happened — still converting for recent days'
      ),
      outcomeRow('No-show', last7.noShow, prev7.noShow, 'CRM stage "Call Missed Several Times"'),
      outcomeRow(
        'Accepted',
        last7.accepted,
        prev7.accepted,
        'Booking-day cohort; climbs as it ages'
      ),
      outcomeRow(
        'Lost / disqualified',
        last7.disqualifiedLost,
        prev7.disqualifiedLost,
        'Closed out negative'
      ),
    ],
  };

  const caveats = [
    `Match rate: ${camp.matchedToCamp}/${camp.accepted} (${pct(matchRate)}) of accepted contractors join to a CAMP team. The acquisition CRM and CAMP share no id, so they join on email; the misses have no Wonderly account. Every CAMP count above is a floor.`,
    `Acquisition cost is total Facebook spend across ${cohortStart} – ${addDays(cohortEnd, -1)}. This is reproducible but differs from the hand-built 2026-08-06 readout, which used a per-contractor attribution that could not be reconstructed from Meta or Snowflake.`,
    'Booking-day cohorts keep converting for weeks. The window is already lagged 14 days, but the most recent acceptances may still be climbing.',
    'Collected revenue share is near zero across every cohort so far — too early, not a negative signal.',
  ];

  if (camp.campSucceeding < MIN_SUCCEEDING) {
    caveats.unshift(
      `Only ${camp.campSucceeding} scored succeeding (below the ${MIN_SUCCEEDING} minimum), so no cost-per-succeeding figure is shown — the denominator is too small to divide into.`
    );
  }

  return {
    today,
    cohortStart,
    cohortEnd,
    cohortLabel,
    cohortSpend,
    costPerAccepted,
    costPerSucceeding,
    meetsGoal: costPerSucceeding !== null && costPerSucceeding <= GOAL_COST_PER_SUCCEEDING,
    matchRate,
    camp,
    tables: [northStar, stages, acquisition, outcomes],
    caveats,
  };
}

/**
 * The Slack TL;DR — the north-star number against goal, the funnel in one line, and the link
 * to the full readout.
 *
 * Deliberately short. Anyone who wants the four tables, the conversions, or the caveats opens
 * the Notion page; a Slack post long enough to cover them stops being read at all. The two
 * things that cannot be dropped are the goal verdict and the match rate — without the latter
 * the counts look like totals rather than the floors they are.
 *
 * @param update - The computed readout
 * @param notionUrl - Link to the published Notion page, when it was created
 */
export function toSlackSummary(update: AcquisitionUpdate, notionUrl?: string): string {
  const { camp } = update;

  const headline =
    update.costPerSucceeding === null
      ? `*Cost per succeeding contractor:* maturing — only ${camp.campSucceeding}/${camp.matchedToCamp} scored succeeding`
      : `*Cost per succeeding contractor:* ${usd(update.costPerSucceeding)} — ${
          update.meetsGoal ? '✅ within' : '⚠️ over'
        } the ${usd(GOAL_COST_PER_SUCCEEDING)} goal`;

  const lines = [
    `*Growth — acquisition update · ${update.today}*`,
    headline,
    `${camp.accepted} accepted · ${camp.launchedAds} launched ads · ${camp.campSucceeding} succeeding · ${camp.wonAJob} won a job · ${camp.revshareCollected} collected`,
    `${update.cohortLabel} · ${usd(update.cohortSpend)} Facebook spend · ${pct(update.matchRate)} matched to CAMP (counts are a floor)`,
  ];

  if (notionUrl) lines.push(`📄 <${notionUrl}|Full readout>`);

  return lines.join('\n');
}
