/**
 * GET /api/cron/linkedin-daily
 *
 * Refreshes the "LinkedIn Daily Metrics" tab of the Marketing Performance sheet. Runs hourly
 * via Vercel cron (see vercel.json), a few minutes after `marketing-daily`.
 *
 * Deliberately a SEPARATE cron from `marketing-daily`: it reads its own sources and writes
 * only its own tab, so a LinkedIn auth/API problem can never break Daily Metrics or any other
 * tab — and nothing about the existing tabs changes.
 *
 * Sources: LinkedIn Advertising API (spend / impressions / clicks / engagements) joined on
 * date to Snowflake (Amplitude + CRM funnel for LinkedIn-tagged people/deals).
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>`.
 */

import { NextResponse } from 'next/server';

import { isoDate } from '@/lib/growth-config';
import { buildDailyMetricsFormatRequests } from '@/lib/daily-metrics-format';
import {
  LINKEDIN_DAILY_METRICS_FORMAT,
  computeLinkedinDailyMetrics,
  joinLinkedinDays,
} from '@/lib/linkedin-metrics';
import { GoogleSheetsService } from '@/services/google-sheets';
import { LinkedInAdsService, type LinkedInDailySpend } from '@/services/linkedin';
import { createLogger } from '@/services/logger';
import { SlackService } from '@/services/slack';
import { SnowflakeService, type BookingOverride } from '@/services/snowflake';

const logger = createLogger('LinkedInDailyCron');

const LINKEDIN_TAB = 'LinkedIn Daily Metrics';

/** Shared with marketing-daily — read only, never written here. */
const BOOKING_OVERRIDES_TAB = 'booking_overrides';

/** The Wonderly LinkedIn ad account was created 10/16/2026; nothing before it exists. */
const LINKEDIN_START = '2026-10-16';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const sheetId = process.env.MARKETING_SHEET_ID;

  if (!sheetId) {
    return NextResponse.json({ error: 'MARKETING_SHEET_ID is not configured' }, { status: 503 });
  }

  const linkedin = await LinkedInAdsService.fromEnv();

  if (!linkedin) {
    // Not configured yet — skip quietly rather than alerting every hour.
    return NextResponse.json({ ok: true, skipped: 'LinkedIn env vars not set' });
  }

  const snow = SnowflakeService.fromEnv();

  try {
    const today = isoDate(new Date());
    const ptToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const days =
      Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${LINKEDIN_START}T00:00:00Z`)) / 86_400_000
      ) + 1;

    const sheets = GoogleSheetsService.fromEnv();
    const bookingOverrides = parseBookingOverrides(
      await sheets.readRows(sheetId, BOOKING_OVERRIDES_TAB).catch(() => [])
    );

    // LinkedIn is the money; Snowflake is the funnel. Spend failing is reported but still
    // writes the funnel (spend reads 0) so the tab never goes stale silently.
    let spendError: string | null = null;
    const [spend, funnel] = await Promise.all([
      linkedin.getDailySpendForDateRange(LINKEDIN_START, today).catch((e): LinkedInDailySpend[] => {
        spendError = e instanceof Error ? e.message : String(e);
        logger.error('LinkedIn spend fetch failed', e);

        return [];
      }),
      snow.getLinkedinFunnel(days, bookingOverrides),
    ]);

    const joined = joinLinkedinDays(spend, funnel);
    const values = computeLinkedinDailyMetrics(joined, ptToday);

    await sheets.ensureTab(sheetId, LINKEDIN_TAB);
    // Same write sequence as Daily Metrics: clear stale merges first (a merge left from an
    // older layout eats header labels), write values, then apply the shared formatter.
    await sheets.unmergeAll(sheetId, LINKEDIN_TAB);
    await sheets.replaceRows(sheetId, LINKEDIN_TAB, values[0].map(String), values.slice(1));

    try {
      await sheets.formatTab(sheetId, LINKEDIN_TAB, (gid) =>
        buildDailyMetricsFormatRequests(gid, LINKEDIN_DAILY_METRICS_FORMAT, [], values)
      );
    } catch (formatError) {
      logger.error('LinkedIn tab formatting failed (values still written)', formatError);
    }

    if (spendError) {
      await notifySlack(`LinkedIn spend fetch failed (tab written with $0 spend): ${spendError}`);
    }

    return NextResponse.json({
      ok: true,
      days: joined.length,
      newestDate: joined[0]?.date ?? null,
      spendError,
    });
  } catch (error) {
    logger.error('LinkedIn tab refresh failed', error);
    await notifySlack(
      `LinkedIn tab refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );

    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  } finally {
    await snow.close();
  }
}

/** Post a failure to the same Slack channel marketing-daily alerts go to. Never throws. */
async function notifySlack(message: string): Promise<void> {
  const channel = process.env.MARKETING_ALERT_SLACK_CHANNEL_ID;

  if (!channel) return;

  try {
    const slack = new SlackService(
      process.env.SLACK_BOT_TOKEN ?? '',
      process.env.SLACK_SIGNING_SECRET ?? ''
    );

    await slack.postMessage(channel, `⚠️ ${message}`);
  } catch (error) {
    logger.error('Failed to post LinkedIn alert to Slack', error);
  }
}

/** Same parsing as marketing-daily's booking_overrides reader (DEAL_ID, BOOKED_DAY). */
function parseBookingOverrides(values: (string | number)[][]): BookingOverride[] {
  return values
    .slice(1)
    .map((row) => ({ dealId: String(row[0] ?? '').trim(), bookedDay: toIsoDate(row[1]) }))
    .filter((o): o is BookingOverride => o.dealId !== '' && o.bookedDay !== '');
}

function toIsoDate(value: string | number | undefined): string {
  const s = String(value ?? '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : '';
}
