/**
 * Auto-pause — the I/O side: per-campaign settings in Redis, data from Meta, pausing, Slack.
 * Started with the Winners campaign (hence the file name); each campaign on the page now
 * has its own settings, runs and history.
 * The rules themselves live in `./winners-autopause.ts` (pure, tested).
 *
 * Used by:
 *   - `GET /api/cron/winners-autopause` (daily Vercel cron) → `runAllCampaigns()`
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
  WINNERS_CAMPAIGN_ID,
  formatSlackSummary,
  planRun,
  sanitizeSettings,
  type AdDay,
  type AutopauseRun,
  type AutopauseSettings,
} from './winners-autopause';
import { getResultCount } from './automation-utils';
import { isMetaRateLimit } from './meta-error-response';
import { buildAdsManagerAdLink } from './ads-manager-link';
import { WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID } from './growth-config';
import { getRedisClient } from './redis';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';
import { createSlackService } from '@/services/slack';

const logger = createLogger('WinnersAutopause');

const CAMPAIGNS_KEY = 'winners_autopause:campaigns';

/**
 * Redis keys for one campaign. Winners keeps the original un-suffixed keys so its settings,
 * runs and history from before multi-campaign support carry over untouched.
 */
function keys(campaignId: string) {
  const suffix = campaignId === WINNERS_CAMPAIGN_ID ? '' : `:${campaignId}`;

  return {
    settings: `winners_autopause:settings${suffix}`,
    runs: `winners_autopause:runs${suffix}`,
    changes: `winners_autopause:changes${suffix}`,
  };
}

/** A campaign the auto-pause rules run on. */
export interface AutopauseCampaign {
  id: string;
  name: string;
}

/** Pay Per Results — the testing campaign that feeds Winners. */
export const PAY_PER_RESULTS_CAMPAIGN_ID = '120242022304100408';

/**
 * Used until someone adds/removes a campaign on the page. Pay Per Results has no saved
 * settings at first, so it picks up a copy of Winners' rules in Dry run (see loadSettings).
 */
const DEFAULT_CAMPAIGNS: AutopauseCampaign[] = [
  { id: WINNERS_CAMPAIGN_ID, name: 'Wonderly | Prospecting | Remodeling Winners' },
  {
    id: PAY_PER_RESULTS_CAMPAIGN_ID,
    name: 'Wonderly | Prospecting | Remodeling Pay Per Results',
  },
];

/** Campaigns that have auto-pause rules (each with its own settings). Winners by default. */
export async function loadCampaigns(): Promise<AutopauseCampaign[]> {
  const redis = await getRedisClient();

  if (!redis) return DEFAULT_CAMPAIGNS.map((c) => ({ ...c }));

  try {
    const raw = await redis.get(CAMPAIGNS_KEY);
    const list = raw ? (JSON.parse(raw) as AutopauseCampaign[]) : null;

    return list && list.length > 0 ? list : DEFAULT_CAMPAIGNS.map((c) => ({ ...c }));
  } catch {
    logger.warn('Malformed campaign list in Redis — using Winners only');

    return DEFAULT_CAMPAIGNS.map((c) => ({ ...c }));
  }
}

/**
 * Add a campaign. Its rules start as a copy of `copyFrom`'s (Winners by default) and it
 * starts in Dry run, so nothing is paused until someone has looked at it.
 */
export async function addCampaign(
  campaign: AutopauseCampaign,
  by: string,
  copyFrom = WINNERS_CAMPAIGN_ID
): Promise<AutopauseCampaign[]> {
  const redis = await getRedisClient();

  if (!redis) throw new Error('Redis is not available — campaigns cannot be added');

  const id = campaign.id.replace(/\D/g, '');

  if (!id) throw new Error('Missing campaign ID');

  const list = await loadCampaigns();

  if (!list.some((c) => c.id === id)) {
    const { settings: source } = await loadSettings(copyFrom);
    const existing = await redis.get(keys(id).settings);

    if (!existing) {
      await redis.set(
        keys(id).settings,
        JSON.stringify(sanitizeSettings({ ...source, campaignId: id, enabled: true, dryRun: true }))
      );
    }

    list.push({ id, name: campaign.name || id });
    await redis.set(CAMPAIGNS_KEY, JSON.stringify(list));
    await logChange(id, by, { campaign: [null, 'added (dry run)'] });
  }

  return list;
}

/** Stop running the rules on a campaign. Its settings and history are kept. */
export async function removeCampaign(id: string, by: string): Promise<AutopauseCampaign[]> {
  const redis = await getRedisClient();

  if (!redis) throw new Error('Redis is not available — campaigns cannot be removed');

  const list = (await loadCampaigns()).filter((c) => c.id !== id);

  if (list.length === 0) throw new Error('Keep at least one campaign');

  await redis.set(CAMPAIGNS_KEY, JSON.stringify(list));
  await logChange(id, by, { campaign: ['on', 'removed'] });

  return list;
}

async function logChange(
  campaignId: string,
  by: string,
  changes: Record<string, [unknown, unknown]>
): Promise<void> {
  const redis = await getRedisClient();

  if (!redis) return;

  const entry = { at: new Date().toISOString(), by, changes };

  await redis.lPush(keys(campaignId).changes, JSON.stringify(entry));
  await redis.lTrim(keys(campaignId).changes, 0, MAX_CHANGES - 1);
}

const MAX_CHANGES = 30;
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
export async function loadSettings(campaignId = WINNERS_CAMPAIGN_ID): Promise<{
  settings: AutopauseSettings;
  persisted: boolean;
}> {
  const redis = await getRedisClient();

  if (!redis) {
    return { settings: { ...DEFAULT_AUTOPAUSE_SETTINGS, campaignId }, persisted: false };
  }

  const raw = await redis.get(keys(campaignId).settings);
  let parsed: Partial<AutopauseSettings> | null = null;

  try {
    parsed = raw ? (JSON.parse(raw) as Partial<AutopauseSettings>) : null;
  } catch {
    logger.warn('Malformed settings in Redis — using defaults');
  }

  // A campaign with nothing saved yet follows Winners' rules, always starting in Dry run.
  if (!raw && campaignId !== WINNERS_CAMPAIGN_ID) {
    const { settings: winners } = await loadSettings(WINNERS_CAMPAIGN_ID);

    parsed = { ...winners, enabled: true, dryRun: true };
  }

  return { settings: sanitizeSettings({ ...parsed, campaignId }), persisted: true };
}

/** One saved change to the settings, for the "Change history" list on the page. */
export interface SettingsChange {
  at: string;
  by: string;
  /** field → [before, after] */
  changes: Record<string, [unknown, unknown]>;
}

/**
 * Save settings (merged over current) and log what changed and who changed it.
 * Returns the saved settings.
 */
export async function saveSettings(
  campaignId: string,
  patch: Partial<AutopauseSettings>,
  by = 'unknown'
): Promise<AutopauseSettings> {
  const redis = await getRedisClient();

  if (!redis) throw new Error('Redis is not available — settings cannot be saved');

  const { settings: current } = await loadSettings(campaignId);
  const next = sanitizeSettings({ ...current, ...patch, campaignId });
  const changes: SettingsChange['changes'] = {};

  for (const key of Object.keys(next) as Array<keyof AutopauseSettings>) {
    if (current[key] !== next[key]) changes[key] = [current[key], next[key]];
  }

  await redis.set(keys(campaignId).settings, JSON.stringify(next));

  if (Object.keys(changes).length > 0) await logChange(campaignId, by, changes);

  return next;
}

/** Recent settings changes, newest first. */
export async function loadChanges(
  campaignId = WINNERS_CAMPAIGN_ID,
  limit = 10
): Promise<SettingsChange[]> {
  const redis = await getRedisClient();

  if (!redis) return [];

  const raw = await redis.lRange(keys(campaignId).changes, 0, limit - 1);

  return raw.flatMap((r) => {
    try {
      return [JSON.parse(r) as SettingsChange];
    } catch {
      return [];
    }
  });
}

/** Most recent runs, newest first. */
export async function loadRuns(campaignId = WINNERS_CAMPAIGN_ID, limit = 10): Promise<StoredRun[]> {
  const redis = await getRedisClient();

  if (!redis) return [];

  const raw = await redis.lRange(keys(campaignId).runs, 0, limit - 1);

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

  await redis.lPush(keys(run.settings.campaignId).runs, JSON.stringify(run));
  await redis.lTrim(keys(run.settings.campaignId).runs, 0, MAX_RUNS - 1);
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
  let text = formatSlackSummary(run, base ? `${base}/autopause` : undefined, (adId) =>
    buildAdsManagerAdLink(WONDERLY_AD_ACCOUNT_ID, WONDERLY_BUSINESS_ID, adId)
  );

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
export async function runAutopause(
  trigger: RunTrigger,
  campaign: AutopauseCampaign = DEFAULT_CAMPAIGNS[0]
): Promise<StoredRun> {
  const { settings, persisted } = await loadSettings(campaign.id);
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
    campaignName: campaign.name,
    ranAt: new Date().toISOString(),
    throughDate,
    settings: effective,
    evaluations,
    paused: [],
    overLimit,
    errors: [],
    inputs: ads,
  };

  if (!persisted) run.note = 'Redis unavailable — ran as dry run';

  if (!effective.dryRun && toPause.length > 0) {
    // Re-check the switch right before acting, in case someone hit Stop mid-run.
    const latest = await loadSettings(campaign.id);

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

/**
 * Daily cron: run every campaign that's switched on, one after another (keeps Meta's
 * per-hour request limit happy). One campaign failing doesn't stop the others — its
 * failure is posted to Slack and the rest carry on.
 */
export async function runAllCampaigns(): Promise<
  Array<{ campaign: AutopauseCampaign; run?: StoredRun; skipped?: string; error?: string }>
> {
  const results: Array<{
    campaign: AutopauseCampaign;
    run?: StoredRun;
    skipped?: string;
    error?: string;
  }> = [];

  for (const campaign of await loadCampaigns()) {
    const { settings } = await loadSettings(campaign.id);

    if (!settings.enabled) {
      results.push({ campaign, skipped: 'stopped' });
      continue;
    }

    try {
      results.push({ campaign, run: await runAutopause('cron', campaign) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`Auto-pause run failed for ${campaign.name} — nothing paused`, error);
      results.push({ campaign, error: reason });

      const channel = autopauseSlackChannel();

      if (channel) {
        await createSlackService()
          .postMessage(
            channel,
            `*Auto-pause couldn't run today for ${campaign.name}.* Nothing was paused.\n${reason}`
          )
          .catch(() => null);
      }
    }
  }

  return results;
}
