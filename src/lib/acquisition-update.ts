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
  /** Plain-language explanation shown above the table. Answers "why am I looking at this?". */
  note?: string;
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
    title: 'What it costs us to find a contractor who works out',
    note: `Three numbers come from three places. **How much we spent on ads** comes from Facebook's own billing for Wonderly's ad account. **Who signed up** comes from our sales system. **How they're doing now** comes from CAMP. Nothing here is typed in by hand.`,
    headers: [
      'What we are measuring',
      'Which contractors',
      'Today',
      'Target',
      'The sum',
      'How we work it out',
    ],
    rows: [
      [
        'What we spend to get one contractor who works out',
        `The ${camp.accepted} contractors we took on ${cohortLabel}, checked ${today}`,
        succeedingCell,
        `${usd(GOAL_COST_PER_SUCCEEDING)} or less`,
        `${usd(cohortSpend)} ÷ ${camp.campSucceeding}`,
        `Add up every dollar we paid Facebook during the three weeks this group signed up (${usd(cohortSpend)}). Divide by how many of them CAMP now says are doing well (${camp.campSucceeding}). So each one that works out has cost us that much in ads.`,
      ],
      [
        'What we spend to sign up one contractor',
        `The same ${camp.accepted} contractors`,
        costPerAccepted === null ? '—' : usd(costPerAccepted),
        'No target — it feeds the number above',
        `${usd(cohortSpend)} ÷ ${camp.accepted}`,
        `The same ad money (${usd(cohortSpend)}), but divided by everyone we took on (${camp.accepted}) instead of only the ones doing well. This is what it costs to get someone through the door, before we know whether they will succeed.`,
      ],
      [
        'Contractors we can prove are succeeding',
        `The same ${camp.accepted} contractors`,
        '0',
        'Earning $100k a month, and $1.50 back for every $1 we spend',
        'Counted by hand',
        `This is the strictest possible test and nobody passes it yet — you need months of steady earnings to qualify. The ${camp.campSucceeding} above look promising, but "promising" is a forecast, not proof.`,
      ],
    ],
  };

  const launched = camp.launchedAds;

  /** Conversion against launched — the honest denominator once ads are the gate. */
  const ofLaunched = (n: number): string =>
    launched > 0 ? `${pct(n / launched)} of launched` : '—';

  const yesterday = cohortWindow(addDays(today, -1));
  const tomorrow = cohortWindow(addDays(today, 1));

  const stages: ReadoutTable = {
    title: 'How this group of contractors is doing',
    note: [
      `We follow one group at a time: everyone we took on during a three-week stretch. Today that group is **${cohortStart} to ${addDays(cohortEnd, -1)}**.`,
      `**It shifts by one day, every day.** Yesterday's report followed ${yesterday.start} to ${addDays(yesterday.end, -1)}; tomorrow's will follow ${tomorrow.start} to ${addDays(tomorrow.end, -1)}. There is never a moment where we switch to a brand-new group — the three-week window simply slides along. Most of the people are the same from one day to the next: one day's worth of contractors joins at one end and drops off at the other.`,
      `**Why it stops ${COHORT_LAG_DAYS} days before today:** a contractor we accepted last week has not had time to get their ads running, let alone win a job. Counting them would drag every number below down and make us look worse than we are. So we only look at people who have had at least ${COHORT_LAG_DAYS} days to get going.`,
    ].join('\n\n'),
    headers: [
      'Stage',
      'Contractors',
      'Share of the group',
      'Share of those running ads',
      'What this means',
    ],
    rows: [
      [
        'We took them on',
        `${camp.accepted}`,
        '100%',
        '—',
        'Everyone we accepted in those three weeks. Every row below is part of this group.',
      ],
      [
        'Matched to a CAMP customer',
        `${camp.matchedToCamp}`,
        shareOf(camp.matchedToCamp, camp.accepted),
        '—',
        `Our sales system and CAMP don't share an ID, so we link them by email address. ${camp.accepted - camp.matchedToCamp} never set up a Wonderly account, so there is nothing to look up. Every number below counts only the ${camp.matchedToCamp} we can see — the real figures can only be higher, never lower.`,
      ],
      [
        'Their ads are running',
        `${launched}`,
        shareOf(launched, camp.accepted),
        '—',
        `We are actually spending money advertising for them. ${camp.matchedToCamp - launched} signed up but haven't got going yet.`,
      ],
      [
        'CAMP says they are doing well',
        `${camp.campSucceeding}`,
        shareOf(camp.campSucceeding, camp.accepted),
        ofLaunched(camp.campSucceeding),
        'CAMP gives every contractor a health label. These have the best one. It is a forecast based on the jobs in their pipeline — not money we have actually received.',
      ],
      [
        'CAMP says they are doing well or okay',
        `${camp.campOkayOrSucceeding}`,
        shareOf(camp.campOkayOrSucceeding, camp.accepted),
        ofLaunched(camp.campOkayOrSucceeding),
        'The same label, one notch looser. A useful way to see who is not struggling, even if they are not thriving.',
      ],
      [
        'Won at least one job',
        `${camp.wonAJob}`,
        shareOf(camp.wonAJob, camp.accepted),
        ofLaunched(camp.wonAJob),
        'A homeowner actually signed a contract with them. This is the first point where something real has happened.',
      ],
      [
        'We have billed them our share',
        `${camp.revshareBooked}`,
        shareOf(camp.revshareBooked, camp.accepted),
        ofLaunched(camp.revshareBooked),
        'We take a cut of each job they win. We have sent the bill, but the money has not arrived.',
      ],
      [
        'They have paid us our share',
        `${camp.revshareCollected}`,
        shareOf(camp.revshareCollected, camp.accepted),
        ofLaunched(camp.revshareCollected),
        camp.revshareCollected === 0
          ? 'Nobody yet. Contractors pay us roughly 15 and 60 days after a job is signed, so this stays at zero for months before it moves.'
          : 'Money that has actually reached our bank account. This is the only number here that is certain.',
      ],
    ],
  };

  const costPerCall1 = (t: WindowTotals): number | null =>
    t.booked > 0 ? Math.round(t.fbSpend / t.booked) : null;

  const last7Cpc = costPerCall1(last7);
  const prev7Cpc = costPerCall1(prev7);

  const acquisition: ReadoutTable = {
    title: 'What we spent last week to get contractors interested',
    note: `This is about **us advertising to contractors**, not contractors advertising to homeowners. It has nothing to do with the group above — it is simply the last full week compared with the week before, so we can see whether ads are getting cheaper or more expensive. Today is excluded because the day is not over.`,
    headers: [
      'What we are measuring',
      `Last 7 days (${last7Start} to ${addDays(last7End, -1)})`,
      `Week before (${prev7Start} to ${addDays(last7Start, -1)})`,
      'Change',
    ],
    rows: [
      [
        'Money paid to Facebook',
        usd(last7.fbSpend),
        usd(prev7.fbSpend),
        wowChange(last7.fbSpend, prev7.fbSpend),
      ],
      [
        'Contractors who booked a first call',
        `${last7.booked}`,
        `${prev7.booked}`,
        wowChange(last7.booked, prev7.booked),
      ],
      [
        'What each booked call cost us',
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
    title: "What happened to last week's booked calls — so far",
    note: `⚠️ **Read the "so far" carefully.** These are calls booked in the last week, and most of them **have not happened yet** — people book a week or two ahead. So every row below is a part-finished story, and the percentages look far worse than reality. A booking from ${last7Start} might not have its call until late this month. The right way to read this table is "what do we know already", not "how did last week go". For settled numbers, look at the group in the second table, which has had ${COHORT_LAG_DAYS} days to finish.`,
    headers: [
      'What happened',
      'How many so far',
      "Share of last week's bookings",
      `Same point for the week before (${prev7Start} to ${addDays(last7Start, -1)})`,
      'What this means',
    ],
    rows: [
      outcomeRow(
        'Booked a first call with us',
        last7.booked,
        prev7.booked,
        'Every row below is a slice of this number.'
      ),
      outcomeRow(
        'The call actually happened',
        last7.held,
        prev7.held,
        'Low because most of these calls are still in the future — not because people stopped showing up.'
      ),
      outcomeRow(
        'Booked, then never turned up',
        last7.noShow,
        prev7.noShow,
        'They picked a time and did not show up. This is the single biggest place we lose people, and we paid for every one of these bookings.'
      ),
      outcomeRow(
        'We took them on',
        last7.accepted,
        prev7.accepted,
        'Will keep climbing for weeks as the remaining calls happen. Almost meaningless this early.'
      ),
      outcomeRow(
        'Not a fit',
        last7.disqualifiedLost,
        prev7.disqualifiedLost,
        'Either we decided they were not right for us, or they walked away.'
      ),
    ],
  };

  const caveats = [
    `**We can only see ${camp.matchedToCamp} of the ${camp.accepted} contractors.** Our sales system and CAMP were built separately and share no ID number, so the only way to connect a contractor across both is by their email address. That works for ${camp.matchedToCamp} of them. The other ${camp.accepted - camp.matchedToCamp} never created a Wonderly account, so there is genuinely nothing to look up — this is not a computer error. It means every CAMP number here is a **minimum**: the truth can only be better, never worse.`,
    `**"What we spent" means all our Facebook advertising between ${cohortStart} and ${addDays(cohortEnd, -1)}.** We cannot tell which specific advert brought in which specific contractor, so we take everything we spent during the weeks they signed up and share it out across them. It is a fair average, not a precise per-person cost.`,
    `**Yesterday's numbers were worked out a different way**, by hand, so they will not line up with these. Going forward every day uses the same method, so day-to-day comparisons are trustworthy even where comparisons with the old report are not.`,
    `**Expect these numbers to drift upward.** Contractors take weeks to get going, win a job, and pay us. We already ignore anyone who signed up in the last ${COHORT_LAG_DAYS} days for that reason, but even the people in this group are not finished yet.`,
    `**Almost nobody has paid us yet, and that is normal.** We bill a contractor about 15 days after they sign a job and again around 60 days. Anyone who signed up recently simply has not reached that point.`,
  ];

  if (camp.campSucceeding < MIN_SUCCEEDING) {
    caveats.unshift(
      `**No cost figure this time.** Only ${camp.campSucceeding} contractors in this group are doing well, and dividing by such a small number gives a wild answer that swings hugely if even one person changes. We show a figure once at least ${MIN_SUCCEEDING} are succeeding.`
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
      ? `*Ad cost per contractor who works out:* not shown yet — only ${camp.campSucceeding} of ${camp.matchedToCamp} are doing well, too few to divide by`
      : `*Ad cost per contractor who works out:* ${usd(update.costPerSucceeding)} — ${
          update.meetsGoal ? '✅ under' : '⚠️ over'
        } our ${usd(GOAL_COST_PER_SUCCEEDING)} target`;

  const lines = [
    `*Growth — acquisition update · ${update.today}*`,
    headline,
    `Of the ${camp.accepted} contractors we took on ${update.cohortLabel}: ${camp.launchedAds} have ads running, ${camp.campSucceeding} are doing well, ${camp.wonAJob} won a job, ${camp.revshareCollected} have paid us.`,
    `We spent ${usd(update.cohortSpend)} on ads to get them. We can only track ${camp.matchedToCamp} of the ${camp.accepted} in CAMP, so these are minimums.`,
  ];

  if (notionUrl) lines.push(`📄 <${notionUrl}|Full readout>`);

  return lines.join('\n');
}
