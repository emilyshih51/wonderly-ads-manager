/**
 * Growth data access for the MCP server — fetches the same Meta + Snowflake data the cron
 * uses and returns it as typed objects (not sheet matrices). Read-only: no writes, no sheet
 * mutation. Each call opens one Snowflake connection and closes it.
 */

import type { Call1DealRow } from '@/lib/call1-deals';
import type { CustomerPnlRow } from '@/lib/customer-pnl';
import { BACKFILL_START, WONDERLY_AD_ACCOUNT_ID, daysSince, isoDate } from '@/lib/growth-config';
import { joinMarketingDaily, type MarketingDailyRow } from '@/lib/marketing-daily';
import type { SucceedingContractors } from '@/lib/succeeding';
import { MetaService } from '@/services/meta';
import { SnowflakeService } from '@/services/snowflake';

/** What to pull. Each dataset is an extra read; `rows` also hits the Meta API. */
export interface GrowthDataOpts {
  /** The daily marketing rows (funnel + spend). Default true; set false to skip Meta. */
  rows?: boolean;
  deals?: boolean;
  succeeding?: boolean;
  pnl?: boolean;
  /** Trailing days for customer P&L (default 90). */
  pnlDays?: number;
}

export interface GrowthData {
  /** Pacific-ish `YYYY-MM-DD` of the run (UTC date). */
  today: string;
  /** One row per day since May 1, newest first — the funnel + spend + cohort outcomes. */
  rows: MarketingDailyRow[];
  call1Deals?: Call1DealRow[];
  succeeding?: SucceedingContractors;
  customerPnl?: CustomerPnlRow[];
}

/**
 * Fetch the Growth data set (mirrors the cron's source reads, minus the sheet merge).
 *
 * @param opts - Which extra datasets to include alongside the daily rows
 */
export async function fetchGrowthData(opts: GrowthDataOpts = {}): Promise<GrowthData> {
  const snow = SnowflakeService.fromEnv();
  const meta = new MetaService(process.env.META_SYSTEM_ACCESS_TOKEN ?? '', WONDERLY_AD_ACCOUNT_ID);

  try {
    const today = isoDate(new Date());
    const backfillDays = daysSince(BACKFILL_START, today) + 1;
    const wantRows = opts.rows !== false;

    let rows: MarketingDailyRow[] = [];

    if (wantRows) {
      const [spend, marketing] = await Promise.all([
        meta.getDailySpendForDateRange(BACKFILL_START, today),
        snow.getDailyMarketing(backfillDays),
      ]);

      rows = joinMarketingDaily(spend, marketing).filter((r) => r.date >= BACKFILL_START);
    }

    const data: GrowthData = { today, rows };

    if (opts.deals) {
      data.call1Deals = (await snow.getCall1Deals(backfillDays)).filter(
        (d) => (d.bookedDay || d.heldDate || d.acceptedDate) >= BACKFILL_START
      );
    }

    if (opts.succeeding) data.succeeding = await snow.getSucceedingContractors();
    if (opts.pnl) data.customerPnl = await snow.getDailyCustomerPnl(opts.pnlDays ?? 90);

    return data;
  } finally {
    await snow.close();
  }
}

/** One ad's booked → held → accepted yield. */
export interface AdPerformanceRow {
  campaignId: string;
  adId: string;
  booked: number;
  held: number;
  accepted: number;
  /** accepted ÷ booked, 0–1. */
  acceptRate: number;
}

/**
 * Rank ads by how many booked deals they produced and how many held / accepted — the
 * "which ad wins" view. Deals with no ad id (organic / unattributed) are skipped.
 *
 * @param deals - Deal-level rows carrying CAMPAIGN_ID / AD_ID
 * @returns Rows sorted by accepted (then booked) descending
 */
export function adPerformance(deals: Call1DealRow[]): AdPerformanceRow[] {
  const byAd = new Map<string, AdPerformanceRow>();

  for (const d of deals) {
    if (!d.adId) continue;

    const cur =
      byAd.get(d.adId) ??
      ({
        campaignId: d.campaignId,
        adId: d.adId,
        booked: 0,
        held: 0,
        accepted: 0,
        acceptRate: 0,
      } as AdPerformanceRow);

    cur.booked += 1;
    cur.held += d.held;
    cur.accepted += d.accepted;
    byAd.set(d.adId, cur);
  }

  return [...byAd.values()]
    .map((r) => ({
      ...r,
      acceptRate: r.booked > 0 ? Math.round((r.accepted / r.booked) * 10000) / 10000 : 0,
    }))
    .sort((a, b) => b.accepted - a.accepted || b.booked - a.booked);
}
