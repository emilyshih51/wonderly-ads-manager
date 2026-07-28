/**
 * GET /api/admin/format-marketing-sheet
 *
 * One-off formatter for the Daily Metrics tab: freezes the header + summary rows,
 * merges the per-metric group headers, applies currency/number/percent number formats,
 * and heat-maps the week-over-week columns.
 *
 * Not on a schedule — formatting is orthogonal to values, so the 3-hourly cron (which
 * only clears + rewrites values) preserves it. Trigger this by hand after a column
 * layout change. Idempotent: existing heat-map rules are cleared before re-applying.
 *
 * Auth mirrors the cron: `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set;
 * 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import { buildDailyMetricsFormatRequests, type MetricFormat } from '@/lib/daily-metrics-format';
import { GoogleSheetsService } from '@/services/google-sheets';
import { createLogger } from '@/services/logger';

const logger = createLogger('FormatMarketingSheet');

const DAILY_METRICS_TAB = 'Daily Metrics';

/** Metric groups in the exact column order computeDailyMetrics writes them. */
const METRICS: MetricFormat[] = [
  { label: 'Spend', money: true },
  { label: 'CPC', money: true },
  { label: 'Page views', money: false },
  { label: 'CTA', money: false },
  { label: 'Partial', money: false },
  { label: 'Qualified', money: false },
  { label: 'Call 1 booked', money: false },
  { label: 'Held', money: false },
  { label: 'Accepted', money: false },
];

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const auth = request.headers.get('authorization');

    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const sheetId = process.env.MARKETING_SHEET_ID;

  if (!sheetId) {
    return NextResponse.json({ error: 'MARKETING_SHEET_ID is not configured' }, { status: 503 });
  }

  try {
    const sheets = GoogleSheetsService.fromEnv();

    await sheets.formatTab(sheetId, DAILY_METRICS_TAB, (gid) =>
      buildDailyMetricsFormatRequests(gid, METRICS)
    );

    logger.info('Formatted Daily Metrics tab');

    return NextResponse.json({ ok: true, tab: DAILY_METRICS_TAB });
  } catch (error) {
    logger.error('Failed to format Daily Metrics tab', error);

    return NextResponse.json({ error: 'Failed to format sheet' }, { status: 500 });
  }
}
