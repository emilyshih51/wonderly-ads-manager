/**
 * Winners Auto-Pause — decides which ads in the Remodeling Winners campaign can't hit the
 * $250 cost-per-trial target and should be paused.
 *
 * Spec: "Winners Campaign Auto-Pause Spec" in Notion (Growth HQ). Three rules:
 *
 * 1. **Poisson ladder (0–7 trials)** — pause when the ad's spend goes over the cap for its
 *    trial count (`LADDER_CAPS`). The caps are deliberately loose: an ad only gets paused once
 *    it's so far behind $250 CPA that bad luck is a poor explanation.
 * 2. **Fatigue (8+ trials)** — pause when the ad got 4 or fewer trials in its last $2,000 of
 *    spend. Catches ads whose total CPA still looks fine because early good days prop up the
 *    average.
 * 3. **No pauses on day one** — skip any ad whose first day of delivery is today; one day is
 *    too little data and trials are often attributed hours late.
 *
 * Used by `GET /api/cron/winners-auto-pause`. All functions are pure so the rules can be
 * unit tested against the spec's examples.
 */

import { getResultCount } from '@/lib/automation-utils';
import { CUSTOM_EVENT_TO_ACTION_TYPE } from '@/services/meta/constants';
import type { MetaInsightsRow } from '@/types';

/** Target cost per trial (qualified form submit) for the Winners campaign. */
export const TARGET_CPA = 250;

/** Rule 1: pause when spend is over `LADDER_CAPS[trials]`. Index = trial count (0–7). */
export const LADDER_CAPS = [575, 970, 1330, 1670, 2000, 2320, 2630, 2940] as const;

/** Rule 2 applies from this many lifetime trials (one past the end of the ladder). */
export const FATIGUE_MIN_LIFETIME_TRIALS = LADDER_CAPS.length;

/** Rule 2: how much of the ad's most recent spend to look at. */
export const FATIGUE_WINDOW_SPEND = 2000;

/** Rule 2: the ad needs at least this many trials in its last $2k to keep running. */
export const FATIGUE_MIN_WINDOW_TRIALS = 5;

/** The Meta action type counted as a "trial" (qualified form submit). */
export const TRIAL_ACTION_TYPE = CUSTOM_EVENT_TO_ACTION_TYPE.START_TRIAL;

/** One day of delivery for one ad. */
export interface AdDay {
  /** `YYYY-MM-DD` in the ad account's timezone. */
  date: string;
  spend: number;
  trials: number;
}

/** All delivery history for one ad in the Winners campaign. */
export interface WinnersAd {
  adId: string;
  adName: string;
  days: AdDay[];
}

export type PauseRule = 'ladder' | 'fatigue';

/** What the bot decided for one ad, plus the numbers behind it (for the Slack post). */
export type WinnersVerdict =
  | {
      action: 'pause';
      rule: PauseRule;
      spend: number;
      trials: number;
      /** Plain-language reason, e.g. "2 trials on $1,412 — cap for 2 trials is $1,330". */
      detail: string;
      /** Rule 2 only: trials in the last $2k. */
      windowTrials?: number;
    }
  | {
      action: 'keep';
      reason: 'first_day' | 'no_spend' | 'under_cap' | 'not_fatigued';
      spend: number;
      trials: number;
      detail: string;
      windowTrials?: number;
    };

/** Format a dollar amount for Slack, e.g. `$1,330`. */
export function formatDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * Trials in the ad's most recent `windowSpend` dollars of spend.
 *
 * Walks back from the newest day adding up spend. Meta only reports spend per day, so the
 * oldest day in the window usually pushes it past the target; that day is counted
 * proportionally (half its spend → half its trials) so the window is exactly `windowSpend`.
 * When the ad has spent less than `windowSpend` in total, every trial counts.
 *
 * @param days - The ad's daily delivery, in any order
 * @param windowSpend - Size of the window in dollars (default: `FATIGUE_WINDOW_SPEND`)
 * @returns Trials in the window (may be fractional because of the proportional boundary day)
 */
export function trialsInLastSpend(days: AdDay[], windowSpend = FATIGUE_WINDOW_SPEND): number {
  const newestFirst = [...days].sort((a, b) => b.date.localeCompare(a.date));
  let spend = 0;
  let trials = 0;

  for (const day of newestFirst) {
    const remaining = windowSpend - spend;

    if (remaining <= 0) break;

    if (day.spend <= remaining) {
      spend += day.spend;
      trials += day.trials;
    } else {
      const fraction = remaining / day.spend;

      spend += remaining;
      trials += day.trials * fraction;
    }
  }

  return trials;
}

/**
 * Apply the three Winners rules to one ad.
 *
 * @param days - The ad's daily delivery since it entered Winners
 * @param today - Today's date (`YYYY-MM-DD`) in the ad account's timezone
 * @returns Whether to pause the ad and why
 */
export function evaluateWinnersAd(days: AdDay[], today: string): WinnersVerdict {
  // Trials can land on a $0-spend day (Meta attributes them late), so totals use every day;
  // only "first day of delivery" needs days that actually spent.
  const delivered = days.filter((d) => d.spend > 0);
  const spend = days.reduce((sum, d) => sum + d.spend, 0);
  const trials = days.reduce((sum, d) => sum + d.trials, 0);

  if (delivered.length === 0) {
    return { action: 'keep', reason: 'no_spend', spend, trials, detail: 'No spend yet' };
  }

  // Rule 3 — no pauses on the first day of delivery.
  const firstDay = delivered.reduce((min, d) => (d.date < min ? d.date : min), delivered[0].date);

  if (firstDay >= today) {
    return {
      action: 'keep',
      reason: 'first_day',
      spend,
      trials,
      detail: 'First day of delivery — not judged yet',
    };
  }

  // Rule 1 — Poisson ladder for 0–7 trials.
  if (trials < FATIGUE_MIN_LIFETIME_TRIALS) {
    const cap = LADDER_CAPS[trials];
    const detail = `${trials} ${pluralTrials(trials)} on ${formatDollars(spend)} — cap for ${trials} ${pluralTrials(trials)} is ${formatDollars(cap)}`;

    return spend > cap
      ? { action: 'pause', rule: 'ladder', spend, trials, detail }
      : { action: 'keep', reason: 'under_cap', spend, trials, detail };
  }

  // Rule 2 — fatigue for 8+ trials.
  const windowTrials = trialsInLastSpend(days);
  const windowLabel = formatTrialCount(windowTrials);
  const detail = `${windowLabel} ${pluralTrials(windowTrials)} in the last ${formatDollars(FATIGUE_WINDOW_SPEND)} (needs ${FATIGUE_MIN_WINDOW_TRIALS}+) — ${trials} trials on ${formatDollars(spend)} overall`;

  return windowTrials < FATIGUE_MIN_WINDOW_TRIALS
    ? { action: 'pause', rule: 'fatigue', spend, trials, windowTrials, detail }
    : { action: 'keep', reason: 'not_fatigued', spend, trials, windowTrials, detail };
}

/**
 * Group ad-level daily insights rows (`time_increment=1`) into per-ad delivery histories.
 *
 * @param rows - Ad-level insights rows, one per ad per day
 * @returns One entry per ad, with spend and trials per day
 */
export function groupDailyRowsByAd(rows: MetaInsightsRow[]): WinnersAd[] {
  const byAd = new Map<string, WinnersAd>();
  const trialLookup = { trial: TRIAL_ACTION_TYPE };

  for (const row of rows) {
    const adId = row.ad_id;
    const date = row.date_start;

    if (!adId || !date) continue;

    let ad = byAd.get(adId);

    if (!ad) {
      ad = { adId, adName: row.ad_name ?? adId, days: [] };
      byAd.set(adId, ad);
    }

    ad.days.push({
      date,
      spend: parseFloat(row.spend ?? '0') || 0,
      trials: getResultCount(row, 'trial', trialLookup),
    });
  }

  return [...byAd.values()];
}

/** Today's date (`YYYY-MM-DD`) in an IANA timezone, e.g. the ad account's `timezone_name`. */
export function todayInTimezone(timezone: string, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function pluralTrials(n: number): string {
  return n === 1 ? 'trial' : 'trials';
}

/** Whole numbers as-is; proportional window counts to one decimal (e.g. `4.3`). */
function formatTrialCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** One ad's verdict, with what's needed to post it. */
export interface WinnersAdResult {
  adId: string;
  adName: string;
  verdict: WinnersVerdict;
  /** Live mode only: whether the pause call to Meta succeeded. */
  paused?: boolean;
  error?: string;
}

const RULE_LABEL: Record<PauseRule, string> = {
  ladder: 'Rule 1 (ladder)',
  fatigue: 'Rule 2 (fatigue)',
};

/**
 * Build the Slack summary for one run, as Slack mrkdwn.
 *
 * Dry runs say "would pause"; live runs say "paused" and flag any pause that failed.
 *
 * @param results - Every ad checked this run
 * @param options.dryRun - Whether this run only reported (no ads were touched)
 * @param options.adLink - Builds the Ads Manager link for an ad ID
 * @returns Message text
 */
export function toWinnersSlackMessage(
  results: WinnersAdResult[],
  options: { dryRun: boolean; adLink: (adId: string) => string }
): string {
  const { dryRun, adLink } = options;
  const flagged = results.filter((r) => r.verdict.action === 'pause');
  const judged = results.filter(
    (r) => r.verdict.action === 'pause' || r.verdict.reason !== 'first_day'
  ).length;
  const skippedFirstDay = results.length - judged;
  const prefix = dryRun
    ? '🧪 *Winners auto-pause — DRY RUN* (nothing was paused)'
    : '⏸️ *Winners auto-pause*';
  const lines = [prefix];

  if (flagged.length === 0) {
    lines.push(`Checked ${judged} active ads — none failed the rules.`);
  } else {
    const verb = dryRun ? 'Would pause' : 'Paused';

    lines.push(`${verb} ${flagged.length} of ${judged} active ads:`);

    for (const r of flagged) {
      if (r.verdict.action !== 'pause') continue;

      const failed = !dryRun && r.paused === false ? ' ⚠️ _pause failed — check Ads Manager_' : '';

      lines.push(
        `• <${adLink(r.adId)}|${r.adName}> — ${RULE_LABEL[r.verdict.rule]}: ${r.verdict.detail}${failed}`
      );
    }
  }

  if (skippedFirstDay > 0) {
    lines.push(`_${skippedFirstDay} ad(s) skipped on their first day of delivery (Rule 3)._`);
  }

  return lines.join('\n');
}
