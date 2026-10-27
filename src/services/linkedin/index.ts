/**
 * LinkedInAdsService — read-only wrapper around LinkedIn's Marketing API (Advertising API
 * product, Development tier) for Wonderly's own ad account.
 *
 * Mirrors what `MetaService.getDailySpendForDateRange` does for Facebook: one call to the
 * reporting endpoint (`/rest/adAnalytics`, `q=analytics`, `pivot=ACCOUNT`,
 * `timeGranularity=DAILY`) returns one row per day with spend, impressions and clicks. That
 * is all the LinkedIn Daily Metrics tab needs from LinkedIn — every funnel step after the
 * click comes from Amplitude + the CRM, same as Daily Metrics.
 *
 * Auth: LinkedIn access tokens expire (~60 days). If `LINKEDIN_REFRESH_TOKEN`,
 * `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are set, a 401 triggers one refresh via
 * the OAuth token endpoint and the call is retried; the refreshed token is cached in Redis
 * (when available) so later runs reuse it instead of refreshing every hour. Without refresh
 * credentials, a 401 surfaces as a clear error so the cron can alert.
 */

import { getRedisClient } from '@/lib/redis';
import { createLogger } from '@/services/logger';

const logger = createLogger('LinkedInAds');

const API_BASE = 'https://api.linkedin.com/rest';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

/**
 * LinkedIn versions its Marketing API monthly (`YYYYMM`) and sunsets each version after
 * roughly a year. Override with `LINKEDIN_API_VERSION` when this one ages out.
 */
export const DEFAULT_LINKEDIN_API_VERSION = '202609';

/** Redis key for the most recently refreshed access token. */
const TOKEN_CACHE_KEY = 'linkedin:ads:access_token';

/** One day of LinkedIn delivery for the whole ad account. */
export interface LinkedInDailySpend {
  /** `YYYY-MM-DD` */
  date: string;
  /** Spend in the account currency (USD for Wonderly). */
  spend: number;
  impressions: number;
  /** All clicks LinkedIn counts (incl. profile/company-name clicks). */
  clicks: number;
  /** Clicks that went to the landing page — the comparable number to Meta's link clicks. */
  landingPageClicks: number;
  /** Likes, comments, shares, follows, clicks… LinkedIn's total engagements. */
  engagements: number;
}

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'LinkedInApiError';
  }
}

interface AnalyticsElement {
  dateRange?: { start?: { year: number; month: number; day: number } };
  costInLocalCurrency?: string | number;
  impressions?: number;
  clicks?: number;
  landingPageClicks?: number;
  totalEngagements?: number;
}

interface RefreshCredentials {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

/** `YYYY-MM-DD` → LinkedIn's Rest.li date literal `(year:2026,month:10,day:27)`. */
export function toRestliDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);

  return `(year:${y},month:${m},day:${d})`;
}

/** Zero-pad a LinkedIn `{year,month,day}` back to `YYYY-MM-DD`. */
function fromRestliDate(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/**
 * Parse the adAnalytics response into one row per day. Exported for tests.
 *
 * @param elements - `elements` array from `/rest/adAnalytics`
 */
export function parseDailyAnalytics(elements: AnalyticsElement[]): LinkedInDailySpend[] {
  return elements
    .filter((e) => e.dateRange?.start)
    .map((e) => ({
      date: fromRestliDate(e.dateRange!.start!),
      // LinkedIn returns cost as a decimal STRING.
      spend: Math.round(Number(e.costInLocalCurrency ?? 0) * 100) / 100,
      impressions: Number(e.impressions ?? 0),
      clicks: Number(e.clicks ?? 0),
      landingPageClicks: Number(e.landingPageClicks ?? 0),
      engagements: Number(e.totalEngagements ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export class LinkedInAdsService {
  constructor(
    private accessToken: string,
    private readonly adAccountId: string,
    private readonly refresh: RefreshCredentials | null = null,
    private readonly apiVersion: string = DEFAULT_LINKEDIN_API_VERSION,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /**
   * Build from env. Returns null when LinkedIn isn't configured, so callers can skip the
   * LinkedIn tab cleanly instead of failing.
   */
  static async fromEnv(): Promise<LinkedInAdsService | null> {
    const accountId = process.env.LINKEDIN_AD_ACCOUNT_ID;
    let token = process.env.LINKEDIN_ACCESS_TOKEN ?? '';

    if (!accountId) return null;

    // Prefer a token refreshed by an earlier run over the (possibly expired) env one.
    try {
      const redis = await getRedisClient();
      const cached = await redis?.get(TOKEN_CACHE_KEY);

      if (cached) token = cached;
    } catch (e) {
      logger.error('Reading cached LinkedIn token failed (using env token)', e);
    }

    const { LINKEDIN_REFRESH_TOKEN, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET } = process.env;
    const refresh =
      LINKEDIN_REFRESH_TOKEN && LINKEDIN_CLIENT_ID && LINKEDIN_CLIENT_SECRET
        ? {
            refreshToken: LINKEDIN_REFRESH_TOKEN,
            clientId: LINKEDIN_CLIENT_ID,
            clientSecret: LINKEDIN_CLIENT_SECRET,
          }
        : null;

    if (!token && !refresh) return null;

    return new LinkedInAdsService(
      token,
      accountId,
      refresh,
      process.env.LINKEDIN_API_VERSION || DEFAULT_LINKEDIN_API_VERSION
    );
  }

  /**
   * Daily spend / impressions / clicks for the whole ad account.
   *
   * @param since - Start date `YYYY-MM-DD` (inclusive)
   * @param until - End date `YYYY-MM-DD` (inclusive)
   */
  async getDailySpendForDateRange(since: string, until: string): Promise<LinkedInDailySpend[]> {
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${this.adAccountId}`);
    // Rest.li 2.0: the query string is built by hand — List()/date literals must NOT be
    // percent-encoded, but the URN inside the List must be.
    const query = [
      'q=analytics',
      'pivot=ACCOUNT',
      'timeGranularity=DAILY',
      `dateRange=(start:${toRestliDate(since)},end:${toRestliDate(until)})`,
      `accounts=List(${accountUrn})`,
      'fields=dateRange,costInLocalCurrency,impressions,clicks,landingPageClicks,totalEngagements',
    ].join('&');

    const data = await this.request<{ elements?: AnalyticsElement[] }>(`/adAnalytics?${query}`);

    return parseDailyAnalytics(data.elements ?? []);
  }

  private async request<T>(path: string, retried = false): Promise<T> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'LinkedIn-Version': this.apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    if (res.status === 401 && !retried && this.refresh) {
      await this.refreshAccessToken();

      return this.request<T>(path, true);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');

      throw new LinkedInApiError(
        `LinkedIn API ${res.status}: ${body.slice(0, 300) || res.statusText}`,
        res.status
      );
    }

    return (await res.json()) as T;
  }

  private async refreshAccessToken(): Promise<void> {
    const r = this.refresh!;
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: r.refreshToken,
        client_id: r.clientId,
        client_secret: r.clientSecret,
      }).toString(),
    });

    if (!res.ok) {
      throw new LinkedInApiError(
        `LinkedIn token refresh failed (${res.status}) — re-authorize the app and update LINKEDIN_REFRESH_TOKEN`,
        res.status
      );
    }

    const json = (await res.json()) as { access_token?: string; expires_in?: number };

    if (!json.access_token) {
      throw new LinkedInApiError('LinkedIn token refresh returned no access_token', 500);
    }

    this.accessToken = json.access_token;

    try {
      const redis = await getRedisClient();

      // Expire the cache a day before LinkedIn does, so we never serve a dead token.
      const ttl = Math.max(60, (json.expires_in ?? 5_184_000) - 86_400);

      await redis?.set(TOKEN_CACHE_KEY, json.access_token, { EX: ttl });
    } catch (e) {
      logger.error('Caching refreshed LinkedIn token failed (will refresh again next run)', e);
    }
  }
}
