/**
 * AmplitudeService — typed wrapper around the Amplitude Dashboard REST API (v2).
 *
 * Used by the marketing-daily cron to fetch booking and qualified-submit counts
 * grouped by `utm_source`. Amplitude is the only system that knows these numbers:
 * the Meta pixel does not fire booking events back, so Meta reports ~2 leads
 * against ~514 real bookings. Do not substitute Meta's `lead` action here.
 *
 * @example
 * ```ts
 * const amp = new AmplitudeService(apiKey, secretKey);
 * const rows = await amp.getDailyEventCountsBySource(
 *   'MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE',
 *   '2026-07-10',
 *   '2026-07-16'
 * );
 * ```
 */

import type { EventDailyCounts } from '@/lib/marketing-daily';

import { AmplitudeApiError, type AmplitudeSegmentationResponse } from './types';

export { AmplitudeApiError };
export type { AmplitudeSegmentationResponse };

/** US data centre. EU orgs use `https://analytics.eu.amplitude.com`. */
const AMPLITUDE_BASE_URL = 'https://amplitude.com';

export class AmplitudeService {
  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = AMPLITUDE_BASE_URL
  ) {}

  /**
   * Build the Basic auth header from the project's API key and secret key.
   * Found in Amplitude under Settings → Projects → wonderly-prod.
   */
  private authHeader(): string {
    const encoded = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');

    return `Basic ${encoded}`;
  }

  /**
   * Fetch daily counts of a single event, grouped by `utm_source`.
   *
   * Amplitude's segmentation endpoint returns a column-oriented shape (one array
   * of counts per group, aligned to a shared `xValues` date array). This method
   * flattens it into one row per (date, utmSource).
   *
   * @param eventType - Exact ingested event name, e.g. `MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE`
   * @param since - Start date, `YYYY-MM-DD` (inclusive)
   * @param until - End date, `YYYY-MM-DD` (inclusive)
   * @returns One entry per date × utm_source with its event count
   * @throws {AmplitudeApiError} When Amplitude returns a non-2xx response
   */
  async getDailyEventCountsBySource(
    eventType: string,
    since: string,
    until: string
  ): Promise<EventDailyCounts[]> {
    const url = new URL('/api/2/events/segmentation', this.baseUrl);

    url.searchParams.set(
      'e',
      JSON.stringify({
        event_type: eventType,
        group_by: [{ type: 'event', value: 'utm_source' }],
      })
    );
    url.searchParams.set('start', toAmplitudeDate(since));
    url.searchParams.set('end', toAmplitudeDate(until));
    // 'uniques' = distinct users per day, not raw event count. The booking and
    // qualified events fire ~twice per person (a tracking double-fire), so 'totals'
    // roughly doubles the real number. Counting unique people gives the true count
    // and stays correct even if the double-fire is fixed upstream.
    url.searchParams.set('m', 'uniques');
    url.searchParams.set('i', '1');

    const response = await this.fetchFn(url.toString(), {
      headers: { Authorization: this.authHeader() },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new AmplitudeApiError(
        `Amplitude segmentation failed for ${eventType}: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    const body = (await response.json()) as AmplitudeSegmentationResponse;

    return flattenSegmentation(body);
  }
}

/**
 * Convert `YYYY-MM-DD` to Amplitude's `YYYYMMDD` date format.
 *
 * @param date - ISO date string
 */
export function toAmplitudeDate(date: string): string {
  return date.replace(/-/g, '');
}

/**
 * Flatten Amplitude's column-oriented segmentation response into one row per
 * (date, utmSource).
 *
 * Defensive by design: Amplitude omits `seriesLabels` when a query has no
 * group-by results, and returns ragged series if a group has no data on some
 * days. Both cases are treated as zero rather than throwing, so a quiet day
 * never fails the cron.
 *
 * @param body - Raw segmentation response
 * @returns Flattened daily counts, excluding zero-count entries
 */
export function flattenSegmentation(body: AmplitudeSegmentationResponse): EventDailyCounts[] {
  const xValues = body?.data?.xValues ?? [];
  const series = body?.data?.series ?? [];
  const labels = body?.data?.seriesLabels ?? [];
  const rows: EventDailyCounts[] = [];

  series.forEach((counts, seriesIndex) => {
    // seriesLabels entries look like [0, "facebook"] — index 1 is the group value.
    const utmSource = labels[seriesIndex]?.[1] ?? '(none)';

    xValues.forEach((date, dateIndex) => {
      const count = counts?.[dateIndex] ?? 0;

      if (count > 0) rows.push({ date, utmSource, count });
    });
  });

  return rows;
}
