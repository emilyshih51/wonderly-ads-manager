/**
 * GET /api/cron/acquisition-update
 *
 * Publishes the daily "Growth — acquisition update" readout: the four-table growth summary
 * from the *Cost per Succeeding Contractor* spec, rebuilt every morning against live data
 * instead of assembled by hand.
 *
 * It joins this repo's acquisition funnel (Meta spend + Snowflake Call 1 outcomes — the same
 * rows the Growth Sheet and MCP already serve) to CAMP's customer outcomes, then writes a
 * dated child page in Notion and posts a summary to Slack.
 *
 * Both publish steps are **best-effort and independent**: a missing `NOTION_TOKEN` or a Slack
 * failure degrades the run to "computed but not published" rather than failing it, and the
 * computed readout always comes back in the response body so a failed publish is still
 * recoverable by hand.
 *
 * Auth follows the existing cron pattern: `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set; 503 in production when it is not.
 */

import { NextResponse } from 'next/server';

import {
  GOAL_COST_PER_SUCCEEDING,
  cohortWindow,
  computeAcquisitionUpdate,
  toSlackSummary,
} from '@/lib/acquisition-update';
import { BACKFILL_START, WONDERLY_AD_ACCOUNT_ID, daysSince, isoDate } from '@/lib/growth-config';
import { joinMarketingDaily } from '@/lib/marketing-daily';
import { createLogger } from '@/services/logger';
import { MetaService } from '@/services/meta';
import {
  bullet,
  callout,
  createNotionService,
  heading,
  paragraph,
  tableBlock,
} from '@/services/notion';
import { createSlackService } from '@/services/slack';
import { SnowflakeService } from '@/services/snowflake';

/**
 * Node runtime with a long ceiling: this run makes a Meta API call, two Snowflake queries
 * (one scanning the whole lifecycle table), and two publish calls. The default serverless
 * timeout kills it partway, which is worse than failing — it can publish Notion and then die
 * before Slack. Matches the MCP route's ceiling.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const logger = createLogger('AcquisitionUpdateCron');

/**
 * The Notion page the dated readouts are filed under — the *Cost per Succeeding Contractor*
 * spec. Overridable so a non-prod run can publish somewhere harmless.
 */
const SPEC_PAGE_ID =
  process.env.NOTION_ACQUISITION_PARENT_PAGE_ID ?? '3b278d7150b381d2b409e20c231138a5';

/**
 * Container page the dated readouts nest under, so the spec page gains one child instead of
 * one per day. Created on the first run and reused after — see `ensureChildPage`.
 */
const GROWTH_REPORT_PAGE_TITLE = 'Growth report';

/** Where the daily TL;DR goes. */
const DEFAULT_GROWTH_CHANNEL = '#emily-space';

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

  const snow = SnowflakeService.fromEnv();
  const meta = new MetaService(process.env.META_SYSTEM_ACCESS_TOKEN ?? '', WONDERLY_AD_ACCOUNT_ID);

  try {
    const today = isoDate(new Date());
    const { start: cohortStart, end: cohortEnd } = cohortWindow(today);
    const backfillDays = daysSince(BACKFILL_START, today) + 1;

    const [spend, marketing, camp] = await Promise.all([
      meta.getDailySpendForDateRange(BACKFILL_START, today),
      snow.getDailyMarketing(backfillDays),
      snow.getCampCohort(cohortStart, cohortEnd),
    ]);

    const rows = joinMarketingDaily(spend, marketing).filter((r) => r.date >= BACKFILL_START);

    const update = computeAcquisitionUpdate({ today, rows, camp, cohortStart, cohortEnd });

    logger.info('Acquisition update computed', {
      today,
      cohortStart,
      cohortEnd,
      accepted: camp.accepted,
      matchedToCamp: camp.matchedToCamp,
      campSucceeding: camp.campSucceeding,
      costPerSucceeding: update.costPerSucceeding,
    });

    const notionUrl = await publishToNotion(update);
    const slackPosted = await postToSlack(update, notionUrl);

    return NextResponse.json({
      ok: true,
      today,
      cohort: { start: cohortStart, end: cohortEnd, label: update.cohortLabel },
      costPerSucceeding: update.costPerSucceeding,
      costPerAccepted: update.costPerAccepted,
      meetsGoal: update.meetsGoal,
      matchRate: update.matchRate,
      camp,
      published: { notion: notionUrl, slack: slackPosted },
      tables: update.tables,
      caveats: update.caveats,
    });
  } catch (error) {
    logger.error('Acquisition update failed', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  } finally {
    await snow.close();
  }
}

/** Publish the readout as a dated Notion child page. Returns its url, or null if not published. */
async function publishToNotion(
  update: ReturnType<typeof computeAcquisitionUpdate>
): Promise<string | null> {
  const notion = createNotionService();

  if (!notion) return null;

  // File under a "Growth report" container rather than directly on the spec page, so the
  // spec keeps one child and the dated readouts read as a series.
  const container = await notion.ensureChildPage(SPEC_PAGE_ID, GROWTH_REPORT_PAGE_TITLE, [
    paragraph(
      'Daily "Growth — acquisition update" readouts, generated automatically each morning by the acquisition-update cron in wonderly-ads-manager. One page per day, newest last.'
    ),
  ]);

  if (!container) {
    logger.error('Could not resolve the Growth report container page — skipping Notion publish');

    return null;
  }

  const blocks = [
    callout(
      `Goal: spend no more than $${GOAL_COST_PER_SUCCEEDING.toLocaleString('en-US')} to acquire one succeeding contractor. Defined as a customer whom Wonderly can consistently generate $100k+ per month at 1.5x+ ROI.`
    ),
    ...update.tables.flatMap((t) => [
      heading(t.title),
      // Each note is one or more paragraphs explaining what the table is and why it is framed
      // this way — the review asked for the reasoning to sit next to the numbers, not below.
      ...(t.note ?? '').split('\n\n').filter(Boolean).map(paragraph),
      tableBlock({ headers: t.headers, rows: t.rows }),
    ]),
    heading('Things worth knowing before you trust these numbers'),
    paragraph(
      `Built automatically on ${update.today}. Nothing here is typed in by hand, so it is consistent day to day — but it is only as good as what the two systems can see, and the points below are the places where that matters.`
    ),
    ...update.caveats.map((c) => bullet(c)),
  ];

  const page = await notion.createPage(
    container.id,
    `Growth — acquisition update ${update.today}`,
    blocks
  );

  return page?.url ?? null;
}

/** Post the Slack summary. Returns whether it landed. */
async function postToSlack(
  update: ReturnType<typeof computeAcquisitionUpdate>,
  notionUrl: string | null
): Promise<boolean> {
  const channel = process.env.SLACK_GROWTH_CHANNEL ?? DEFAULT_GROWTH_CHANNEL;

  const slack = createSlackService();
  const result = await slack.postMessage(channel, toSlackSummary(update, notionUrl ?? undefined));

  return result !== null;
}
