/**
 * Winners auto-pause — the I/O side: settings in Redis, data from Meta, pausing, Slack.
 * The rules themselves live in `./winners-autopause.ts` (pure, tested).
 *
 * Used by:
 *   - `GET /api/cron/winners-autopause` (daily Vercel cron) → `runAutopause('cron')`
 *   - `POST /api/winners-autopause` ("Run check now" on the Auto-pause page) → `runAutopause('preview')`
 *
 * Safety rails (keep these):
 *   1. Kill switch: `settings.enabled = false` (the page's on/off switch) or env
 *      `WINNERS_AUTOPAUSE_DISABLED=1` → the cron does nothing.
 *   2. Dry run is the default. Preview runs never pause, whatever the settings say.
 *   3. No Redis → settings can't be confirmed → treated as dry run.
 *   4. Meta fetch fails → the run fails; nothing is paused.
 *   5. More failures than `maxPausesPerRun` → pause nothing and warn in Slack.
 *   6. Settings are re-read right before pausing, so hitting Stop mid-run still stops it.
 *   7. The job only ever pauses. It never turns an ad on or touches budgets.
 */

import {
  DEFAULT_AUTOPAUSE_SETTINGS,
  formatSlackSummary,
  planRun,
  sanitizeSettings,
  type AdDay,
  type AutopauseRun,
  type AutopauseSettings,
} from './winners-autopause';
import { getResultCount } from './automation-utils';
import { isMetaRateLimit } from './meta-error-response';
import { WONDERLY_AD_ACCOUNT_ID } from './growth-config';
import { getRedisClient } from './redis';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';
import { createSlackService } from '@/services/slack';

const logger = createLogger('WinnersAutopause');

const SETTINGS_KEY = 'winners_autopause:settings';
const RUNS_KEY = 'winners_autopause:runs';
const MAX_RUNS = 30;

export type RunTrigger = 'cron' | 'preview';

export interface StoredRun extends AutopauseRun {
  trigger: RunTrigger;
  errors: Array<{ adId: string; error: string }>;
}

/** True when the env-level kill switch is set (overrides the page). */
export function envKillSwitch(): boolean {
  return ['1', 'true', 'yes'].includes(
    (process.env.WINNERS_AUTOPAUSE_DISABLED ?? '').toLowerCase()
  );
}

/** Load settings. `persisted: false` means Redis is unavailable (treat as dry run). */
export async function loadSettings(): Promise<{
  settings: AutopauseSettings;
  persisted: boolean;
}> {
  const redis = await getRedisClient();

  if (!redis) return { settings: { ...DEFAULT_AUTOPAUSE_SETTINGS }, persisted: false };

  const raw = await redis.get(SETTINGS_KEY);
  let parsed: Partial<AutopauseSettings> | null = null;

  try {
    parsed = raw ? (JSON.parse(raw) as Partial<AutopauseSettings>) : null;
  } catch {
    logger.warn('Malformed settings in Redis — using defaults');
  }

  return { settings: sanitizeSettings(parsed), persisted: true };
}

/** Save settings (merged over current). Returns the saved settings. */
export async function saveSettings(patch: Partial<AutopauseSettings>): Promise<AutopauseSettings> {
  const redis = await getRedisClient();

  if (!redis) throw new Error('Redis is not available — settings cannot be saved');

  const { settings: current } = await loadSettings();
  const next = sanitizeSettings({ ...current, ...patch });

  await redis.set(SETTINGS_KEY, JSON.stringify(next));

  return next;
}

/** Most recent runs, newest first. */
export async function loadRuns(limit = 10): Promise<StoredRun[]> {
  const redis = await getRedisClient();

  if (!redis) return [];

  const raw = await redis.lRange(RUNS_KEY, 0, limit - 1);

  return raw.flatMap((r) => {
    try {
      return [JSON.parse(r) as StoredRun];
    } catch {
      return [];
    }
  });
}

async function saveRun(run: StoredRun): Promise<void> {
  const redis = await getRedisClient();

  if (!redis) return;

  await redis.lPush(RUNS_KEY, JSON.stringify(run));
  await redis.lTrim(RUNS_KEY, 0, MAX_RUNS - 1);
}

/** `YYYY-MM-DD` for `date` in an IANA time zone. */
function dateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);

  d.setUTCDate(d.getUTCDate() + n);

  return d.toISOString().slice(0, 10);
}

/**
 * Pull completed days for every ACTIVE ad in the campaign and turn them into
 * `{ adId, adName, days }`. "Trials" = the ad set's optimization event (same number
 * Ads Manager shows as Results), via the same `getResultCount` the automations use.
 */
export async function fetchCampaignAds(
  meta: MetaService,
  campaignId: string
): Promise<{
  throughDate: string;
  ads: Array<{ adId: string; adName: string; days: AdDay[] }>;
}> {
  const account = await meta.getAdAccount();
  const today = dateInZone(new Date(), account.timezone_name || 'America/Los_Angeles');
  const until = addDays(today, -1); // completed days only
  // Start at the campaign's first day (not a full year back) to keep the pull small —
  // Meta's per-hour request limit is shared with every other cron on this token.
  const startDate = await meta.getCampaignStartDate(campaignId).catch(() => null);
  const oneYearBack = addDays(until, -365);
  const since = startDate && startDate > oneYearBack ? startDate : oneYearBack;

  const [ads, rows, optimizationMap] = await Promise.all([
    meta.getCampaignAds(campaignId),
    meta.getCampaignAdDailyInsights(campaignId, since, until),
    meta.getOptimizationMap(),
  ]);

  const active = ads.filter((a) => a.effectiveStatus === 'ACTIVE');
  const byAd = new Map<string, AdDay[]>();

  for (const row of rows) {
    if (!row.ad_id) continue;
    const days = byAd.get(row.ad_id) ?? [];

    days.push({
      date: String(row.date_start ?? ''),
      spend: Number(row.spend ?? 0),
      trials: getResultCount(row, row.adset_id, optimizationMap),
    });
    byAd.set(row.ad_id, days);
  }

  return {
    throughDate: until,
    ads: active.map((a) => ({ adId: a.id, adName: a.name, days: byAd.get(a.id) ?? [] })),
  };
}

/** Shown on the page and in Slack when Meta's hourly request limit is hit. */
export const RATE_LIMIT_MESSAGE =
  "Meta's hourly request limit was reached, so the check couldn't run. Nothing was paused. Try again in about an hour.";

/** Thrown when Meta rate-limits us even after one retry. */
export class AutopauseRateLimitError extends Error {
  constructor() {
    super(RATE_LIMIT_MESSAGE);
    this.name = 'AutopauseRateLimitError';
  }
}

const RETRY_WAIT_MS = 20_000;

/**
 * Run `fn`; if Meta says "slow down", wait once and retry. A second rate-limit becomes an
 * `AutopauseRateLimitError` with a plain-English message.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  waitMs = RETRY_WAIT_MS
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isMetaRateLimit(error)) throw error;
    logger.warn(`Meta rate limit hit — retrying once in ${waitMs / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    try {
      return await fn();
    } catch (retryError) {
      if (isMetaRateLimit(retryError)) throw new AutopauseRateLimitError();
      throw retryError;
    }
  }
}

/** Slack channel for the summary, or '' when none is configured. */
export function autopauseSlackChannel(): string {
  return process.env.SLACK_AUTOPAUSE_CHANNEL || process.env.SLACK_NOTIFICATION_CHANNEL || '';
}

/**
 * Post a run's summary to Slack. Used by the daily cron and by "Send to Slack" on the page.
 * Returns false when no channel is set or Slack rejected the post (e.g. bot not in channel).
 */
export async function postRunToSlack(run: StoredRun): Promise<boolean> {
  const channel = autopauseSlackChannel();

  if (!channel) return false;

  const base = process.env.NEXT_PUBLIC_APP_URL;
  let text = formatSlackSummary(run, base ? `${base}/autopause` : undefined);

  if (run.trigger === 'preview') text += '\n_Sent by hand from the Auto-pause page_';
  if (run.note) text += `\n_${run.note}_`;
  for (const err of run.errors) text += `\n:x: Couldn't pause ${err.adId}: ${err.error}`;

  const result = await createSlackService().postMessage(channel, text);

  return result !== null;
}

/**
 * Run the check. `cron` may pause (unless dry run / stopped); `preview` never pauses
 * and never posts to Slack — it only refreshes the table on the page.
 */
export async function runAutopause(trigger: RunTrigger): Promise<StoredRun> {
  const { settings, persisted } = await loadSettings();
  const effective: AutopauseSettings = {
    ...settings,
    dryRun: settings.dryRun || !persisted || trigger === 'preview',
  };

  const token = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!token) throw new Error('META_SYSTEM_ACCESS_TOKEN is not configured');

  const meta = new MetaService(token, WONDERLY_AD_ACCOUNT_ID);
  const { throughDate, ads } = await withRateLimitRetry(() =>
    fetchCampaignAds(meta, effective.campaignId)
  );
  const { evaluations, toPause, overLimit } = planRun(ads, effective);

  const run: StoredRun = {
    trigger,
    ranAt: new Date().toISOString(),
    throughDate,
    settings: effective,
    evaluations,
    paused: [],
    overLimit,
    errors: [],
  };

  if (!persisted) run.note = 'Redis unavailable — ran as dry run';

  if (!effective.dryRun && toPause.length > 0) {
    // Re-check the switch right before acting, in case someone hit Stop mid-run.
    const latest = await loadSettings();

    if (!latest.settings.enabled || latest.settings.dryRun || envKillSwitch()) {
      run.note = 'Stopped or switched to dry run during the run — nothing paused';
      run.settings = { ...effective, dryRun: true };
    } else {
      for (const e of toPause) {
        try {
          await meta.updateStatus(e.adId, 'PAUSED');
          run.paused.push(e.adId);
          logger.info('Paused ad', { adId: e.adId, adName: e.adName, reason: e.reason });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          run.errors.push({ adId: e.adId, error: message });
          logger.error('Failed to pause ad', { adId: e.adId, error: message });
        }
      }
    }
  }

  await saveRun(run);

  if (trigger === 'cron') {
    const posted = await postRunToSlack(run);

    if (!posted) logger.warn('Auto-pause summary was not posted to Slack');
  }

  return run;
}
