/**
 * Winners auto-pause — the daily rules that decide which ads in the
 * "Wonderly | Prospecting | Remodeling Winners" campaign should be paused.
 *
 * Plain-English spec: Notion "Winners Campaign Auto-Pause Spec". The code must match it.
 *
 *   Rule 1 (Poisson ladder): if an ad at our target CPA would only look this bad less than
 *     1 in 10 times, pause it. With a $250 target that works out to caps of
 *     0 trials → $575, 1 → $970, 2 → $1,330, 3 → $1,670, 4 → $2,000 …
 *   Rule 2 (fatigue): for ads with 8+ trials, look at the last $2,000 of spend only.
 *     4 or fewer trials in it → pause. The oldest day is prorated so the window is exactly $2k.
 *   Rule 3 (day one): never pause an ad with less than 2 days of spend.
 *
 * Everything in this file is pure (no I/O) so it can be unit-tested and reused by the cron,
 * the preview button on the Auto-pause page, and backtests.
 *
 * NOTE: this deliberately pauses ads that HAVE conversions, which the Automations engine
 * never does (see CLAUDE.md "Never auto-kill an ad that has converted"). That guardrail is
 * for the generic rule builder; this job is scoped to one campaign and has its own safety
 * rails (dry run, kill switch, max pauses per run, fail-closed on missing data).
 */

/** "Wonderly | Prospecting | Remodeling Winners" in the Wonderly ad account. */
export const WINNERS_CAMPAIGN_ID = '120246613517700408';

/** Everything a person can change from the Auto-pause page. */
export interface AutopauseSettings {
  /** Master switch. Off = the daily job does nothing at all. */
  enabled: boolean;
  /** On = check and post to Slack, but never actually pause anything. */
  dryRun: boolean;
  /** Campaign the job watches. */
  campaignId: string;
  /** CPA we're holding ads to, in dollars. */
  targetCpa: number;
  /** Pause when the chance a good ad looks this bad is below this (0.10 = "1 in 10"). */
  cutoff: number;
  /** Rule 2 window, in dollars of most-recent spend. */
  rule2Window: number;
  /** Rule 2 only applies once an ad has at least this many lifetime trials. */
  rule2MinTrials: number;
  /** Rule 3: an ad needs at least this many days with spend before it can be paused. */
  minDays: number;
  /**
   * Safety rail: if more ads than this fail on one day, pause none and warn instead.
   * A wave of failures usually means bad data (e.g. Meta dropped conversions), not bad ads.
   */
  maxPausesPerRun: number;
}

export const DEFAULT_AUTOPAUSE_SETTINGS: AutopauseSettings = {
  enabled: true,
  dryRun: true,
  campaignId: WINNERS_CAMPAIGN_ID,
  targetCpa: 250,
  cutoff: 0.1,
  rule2Window: 2000,
  rule2MinTrials: 8,
  minDays: 2,
  maxPausesPerRun: 5,
};

/** One completed day for one ad. */
export interface AdDay {
  /** `YYYY-MM-DD` */
  date: string;
  spend: number;
  trials: number;
}

export type AutopauseDecision = 'PAUSE' | 'WATCH' | 'OK' | 'TOO_EARLY';

export interface AdEvaluation {
  adId: string;
  adName: string;
  decision: AutopauseDecision;
  /** Which rule failed (only on PAUSE / WATCH). */
  rule: 'rule1' | 'rule2' | null;
  /** Short human reason, shown on the page and in Slack. */
  reason: string;
  spend: number;
  trials: number;
  cpa: number | null;
  daysWithSpend: number;
  /** Rule 1: chance an ad at target CPA would have this few trials at this spend. */
  rule1P: number;
  /** Rule 1: spend cap for the ad's current trial count. */
  rule1Cap: number;
  /** Rule 2 window details, `null` when Rule 2 doesn't apply yet. */
  rule2: { spend: number; trials: number; line: number } | null;
}

/**
 * Chance that an ad that truly runs at `targetCpa` would get `trials` or fewer trials
 * after spending `spend` (Poisson CDF). Same thing as `POISSON.DIST(trials, spend/target, TRUE)`.
 */
export function pGood(trials: number, spend: number, targetCpa: number): number {
  const expected = spend / targetCpa;
  const k = Math.floor(trials);

  if (expected <= 0) return 1;

  let term = Math.exp(-expected);
  let p = term;

  for (let i = 1; i <= k; i++) {
    term *= expected / i;
    p += term;
  }

  return Math.min(1, p);
}

/**
 * Rule 1 cap: the spend at which an ad with `trials` trials crosses the cutoff.
 * $250 / 10% gives 0 → ~$575, 1 → ~$970, 2 → ~$1,330 …
 */
export function rule1Cap(trials: number, targetCpa: number, cutoff: number): number {
  let lo = 0;
  let hi = targetCpa * (trials + 10) * 4;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;

    if (pGood(trials, mid, targetCpa) < cutoff) hi = mid;
    else lo = mid;
  }

  return Math.round(hi);
}

/**
 * Rule 2 line: the most trials an ad can get in the window and still fail.
 * $2,000 / $250 / 10% → 4 (P(≤4 | 8 expected) = 9.96%, P(≤5) = 19.1%).
 */
export function rule2Line(window: number, targetCpa: number, cutoff: number): number {
  let line = -1;

  for (let k = 0; k < 1000; k++) {
    if (pGood(k, window, targetCpa) < cutoff) line = k;
    else break;
  }

  return line;
}

/**
 * Spend and trials in the ad's most recent `window` dollars. The oldest day in the window
 * is prorated so the window is exactly `window` dollars (whole days stretch it to ~$3k and
 * hide drops). Returns `null` if the ad hasn't spent `window` yet.
 */
export function lastWindow(
  days: AdDay[],
  window: number
): { spend: number; trials: number } | null {
  const newestFirst = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  let spend = 0;
  let trials = 0;

  for (const day of newestFirst) {
    if (day.spend <= 0) {
      trials += day.trials;
      continue;
    }

    if (spend + day.spend <= window) {
      spend += day.spend;
      trials += day.trials;
    } else {
      const fraction = (window - spend) / day.spend;

      spend = window;
      trials += day.trials * fraction;
      break;
    }
  }

  if (spend < window - 0.01) return null;

  return { spend, trials: Math.round(trials * 10) / 10 };
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Run Rules 1–3 on one ad's completed days. */
export function evaluateAd(
  ad: { adId: string; adName: string; days: AdDay[] },
  settings: AutopauseSettings
): AdEvaluation {
  const { targetCpa, cutoff } = settings;
  const spend = ad.days.reduce((s, d) => s + d.spend, 0);
  const trials = ad.days.reduce((s, d) => s + d.trials, 0);
  const daysWithSpend = ad.days.filter((d) => d.spend > 0).length;
  const p1 = pGood(trials, spend, targetCpa);
  const cap = rule1Cap(trials, targetCpa, cutoff);

  const line = rule2Line(settings.rule2Window, targetCpa, cutoff);
  const watchLine = rule2Line(settings.rule2Window, targetCpa, cutoff * 2);
  const window =
    trials >= settings.rule2MinTrials ? lastWindow(ad.days, settings.rule2Window) : null;

  const base: AdEvaluation = {
    adId: ad.adId,
    adName: ad.adName,
    decision: 'OK',
    rule: null,
    reason: '',
    spend,
    trials,
    cpa: trials > 0 ? spend / trials : null,
    daysWithSpend,
    rule1P: p1,
    rule1Cap: cap,
    rule2: window ? { ...window, line } : null,
  };

  // Rule 3 — too early to judge.
  if (daysWithSpend < settings.minDays) {
    return { ...base, decision: 'TOO_EARLY', reason: `Only ${daysWithSpend} day of spend` };
  }

  // Rule 1 — too few trials for total spend.
  if (p1 < cutoff) {
    return {
      ...base,
      decision: 'PAUSE',
      rule: 'rule1',
      reason: `${money(spend)} spent with ${trials} trials (cap for ${trials} is ${money(cap)})`,
    };
  }

  // Rule 2 — stopped working in its last $2k.
  if (window && window.trials <= line + 1e-9) {
    return {
      ...base,
      decision: 'PAUSE',
      rule: 'rule2',
      reason: `${window.trials} trials in its last ${money(settings.rule2Window)} (line is ${line})`,
    };
  }

  // Close to a line → watch.
  if (p1 < cutoff * 2) {
    return {
      ...base,
      decision: 'WATCH',
      rule: 'rule1',
      reason: `Close to Rule 1: ${money(spend)} spent, cap for ${trials} trials is ${money(cap)}`,
    };
  }

  if (window && window.trials <= watchLine + 1e-9) {
    return {
      ...base,
      decision: 'WATCH',
      rule: 'rule2',
      reason: `Close to Rule 2: ${window.trials} trials in its last ${money(settings.rule2Window)}`,
    };
  }

  return { ...base, reason: 'Passing' };
}

export interface AutopauseRun {
  ranAt: string;
  /** Last completed day included. */
  throughDate: string;
  settings: AutopauseSettings;
  evaluations: AdEvaluation[];
  /** Ads actually paused this run (empty in dry run). */
  paused: string[];
  /** True when more ads failed than `maxPausesPerRun`, so nothing was paused. */
  overLimit: boolean;
  /** Why this run made no changes, if it didn't. */
  note?: string;
}

const ORDER: Record<AutopauseDecision, number> = { PAUSE: 0, WATCH: 1, TOO_EARLY: 2, OK: 3 };

/** Evaluate every ad and decide which ones to actually pause this run. */
export function planRun(
  ads: Array<{ adId: string; adName: string; days: AdDay[] }>,
  settings: AutopauseSettings
): { evaluations: AdEvaluation[]; toPause: AdEvaluation[]; overLimit: boolean } {
  const evaluations = ads
    .map((ad) => evaluateAd(ad, settings))
    .sort((a, b) => ORDER[a.decision] - ORDER[b.decision] || b.spend - a.spend);
  const failing = evaluations.filter((e) => e.decision === 'PAUSE');
  const overLimit = failing.length > settings.maxPausesPerRun;

  return { evaluations, toPause: overLimit ? [] : failing, overLimit };
}

/** Merge stored settings over defaults and clamp anything out of range. */
export function sanitizeSettings(
  input: Partial<AutopauseSettings> | null | undefined
): AutopauseSettings {
  const s = { ...DEFAULT_AUTOPAUSE_SETTINGS, ...(input ?? {}) };

  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);

    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  return {
    enabled: s.enabled !== false,
    dryRun: s.dryRun !== false,
    campaignId:
      String(s.campaignId || WINNERS_CAMPAIGN_ID).replace(/\D/g, '') || WINNERS_CAMPAIGN_ID,
    targetCpa: num(s.targetCpa, 250, 50, 2000),
    cutoff: num(s.cutoff, 0.1, 0.01, 0.5),
    rule2Window: num(s.rule2Window, 2000, 500, 20000),
    rule2MinTrials: Math.round(num(s.rule2MinTrials, 8, 1, 100)),
    minDays: Math.round(num(s.minDays, 2, 1, 14)),
    maxPausesPerRun: Math.round(num(s.maxPausesPerRun, 5, 0, 50)),
  };
}

/** Slack mrkdwn link `<url|text>`; escapes the characters Slack treats as markup. */
function slackLink(url: string, text: string): string {
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '¦');

  return `<${url}|${safe}>`;
}

/**
 * Slack summary text. Pass `adLink` to turn each ad name into a link (e.g. to Ads Manager),
 * like the other automation notifications.
 */
export function formatSlackSummary(
  run: AutopauseRun,
  pageUrl?: string,
  adLink?: (adId: string) => string
): string {
  const name = (e: AdEvaluation) => (adLink ? slackLink(adLink(e.adId), e.adName) : e.adName);
  const pause = run.evaluations.filter((e) => e.decision === 'PAUSE');
  const watch = run.evaluations.filter((e) => e.decision === 'WATCH');
  const ok = run.evaluations.length - pause.length - watch.length;
  const mode = run.settings.dryRun ? ' (dry run — nothing was paused)' : '';
  const lines = [`*Winners auto-pause — data through ${run.throughDate}*${mode}`];

  if (run.overLimit) {
    lines.push(
      `:warning: ${pause.length} ads failed, more than the limit of ${run.settings.maxPausesPerRun}. Paused nothing — please check the data.`
    );
  }

  const verb = run.settings.dryRun || run.overLimit ? 'Would pause' : 'Paused';

  lines.push(`*${verb} (${pause.length})*`);
  for (const e of pause) lines.push(`• ${name(e)} — ${e.reason}`);
  if (pause.length === 0) lines.push('• none');

  if (watch.length) {
    lines.push(`*Watch (${watch.length})*`);
    for (const e of watch) lines.push(`• ${name(e)} — ${e.reason}`);
  }

  lines.push(`${ok} other ads OK`);
  if (pageUrl) lines.push(`<${pageUrl}|Open the Auto-pause page>`);

  return lines.join('\n');
}
