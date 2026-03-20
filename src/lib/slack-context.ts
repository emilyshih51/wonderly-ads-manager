/**
 * Slack context builder — fetches comprehensive ad data from Meta and formats
 * it as a plain-text context block for Claude to reason over.
 *
 * Used by the Slack Events handler when the bot receives an @mention.
 */

import { MetaService } from '@/services/meta';
import { getResultCount } from '@/lib/automation-utils';
import { createLogger } from '@/services/logger';
import type { MetaInsightsRow } from '@/types';

const logger = createLogger('Slack:Context');

/** Structured ad context for a single ad account, built by {@link fetchAdContextData}. */
export interface AdContextData {
  accountName: string;
  timezoneName: string;
  date: { today: string; yesterday: string; thirtyDaysAgo: string };
  optimizationMap: Record<string, string>;
  /** Campaign objects with `daily_budget` field for budget context. */
  campaignObjects: Array<{ id: string; daily_budget?: string }>;
  today: {
    campaigns: MetaInsightsRow[];
    adSets: MetaInsightsRow[];
    ads: MetaInsightsRow[];
    account: MetaInsightsRow[];
    hourly: MetaInsightsRow[];
  };
  yesterday: {
    campaigns: MetaInsightsRow[];
    adSets: MetaInsightsRow[];
    ads: MetaInsightsRow[];
    account: MetaInsightsRow[];
    hourly: MetaInsightsRow[];
  };
  history: {
    accountDaily: MetaInsightsRow[];
    campaignDaily: MetaInsightsRow[];
    adsetDaily: MetaInsightsRow[];
  };
  breakdowns: {
    ageGender: Array<MetaInsightsRow & { age?: string; gender?: string }>;
    device: MetaInsightsRow[];
    publisher: MetaInsightsRow[];
  };
}

/**
 * Fetch comprehensive ad data for a single ad account using the system access token.
 *
 * Makes up to 19 parallel Meta API calls (today + yesterday snapshots, breakdowns,
 * historical daily data, campaign objects). Partial failures are swallowed — any
 * failed call returns an empty array so the context is still useful.
 *
 * @param adAccountId - Raw ad account ID (without `act_` prefix)
 * @param accessToken - Meta system access token
 * @returns Structured {@link AdContextData}, or mock data if everything fails
 */
export async function fetchAdContextData(
  adAccountId: string,
  accessToken: string
): Promise<AdContextData> {
  const meta = new MetaService(accessToken, adAccountId);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now);

  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const thirtyDaysAgo = new Date(now);

  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  try {
    const results = await Promise.allSettled([
      /* [0]  */ meta.getCampaignLevelInsights('today'),
      /* [1]  */ meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'campaign'),
      /* [2]  */ meta.getAdSetLevelInsights('today'),
      /* [3]  */ meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'adset'),
      /* [4]  */ meta.getAdLevelInsights('today'),
      /* [5]  */ meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'ad'),
      /* [6]  */ meta.getHourlyInsights('today', 'campaign'),
      /* [7]  */ meta.getHourlyInsightsForDate(yesterdayStr, yesterdayStr, 'campaign'),
      /* [8]  */ meta.getAccountInsights('today'),
      /* [9]  */ meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'account'),
      /* [10] */ meta.getInsightsWithBreakdowns('today', 'age,gender'),
      /* [11] */ meta.getInsightsWithBreakdowns('today', 'device_platform'),
      /* [12] */ meta.getInsightsWithBreakdowns('today', 'publisher_platform'),
      /* [13] */ meta.getCampaignOptimizationMap(),
      /* [14] */ meta.getDailyInsights('last_30d', 'account'),
      /* [15] */ meta.getDailyInsights('last_30d', 'campaign'),
      /* [16] */ meta.getDailyInsights('last_7d', 'adset'),
      /* [17] */ meta.getCampaigns(),
      /* [18] */ meta.getAdAccount(),
    ]);

    const extract = (index: number): MetaInsightsRow[] => {
      const r = results[index];

      return r.status === 'fulfilled'
        ? ((r.value as { data?: MetaInsightsRow[] })?.data ?? [])
        : [];
    };

    const optimizationMap =
      results[13].status === 'fulfilled' ? (results[13].value as Record<string, string>) : {};

    const accountInfo =
      results[18].status === 'fulfilled'
        ? (results[18].value as { name?: string; timezone_name?: string })
        : null;

    const campaignObjects =
      results[17].status === 'fulfilled'
        ? ((results[17].value as { data?: Array<{ id: string; daily_budget?: string }> }).data ??
          [])
        : [];

    return {
      accountName: accountInfo?.name ?? `Account ${adAccountId}`,
      timezoneName: accountInfo?.timezone_name ?? 'America/Los_Angeles',
      date: { today: todayStr, yesterday: yesterdayStr, thirtyDaysAgo: thirtyDaysAgoStr },
      optimizationMap,
      campaignObjects,
      today: {
        campaigns: extract(0),
        adSets: extract(2),
        ads: extract(4),
        account: extract(8),
        hourly: extract(6),
      },
      yesterday: {
        campaigns: extract(1),
        adSets: extract(3),
        ads: extract(5),
        account: extract(9),
        hourly: extract(7),
      },
      history: {
        accountDaily: extract(14),
        campaignDaily: extract(15),
        adsetDaily: extract(16),
      },
      breakdowns: {
        ageGender: extract(10) as Array<MetaInsightsRow & { age?: string; gender?: string }>,
        device: extract(11),
        publisher: extract(12),
      },
    };
  } catch (error) {
    logger.error('Error fetching ad data', error);

    return {
      accountName: `Account ${adAccountId}`,
      timezoneName: 'America/Los_Angeles',
      date: { today: todayStr, yesterday: yesterdayStr, thirtyDaysAgo: thirtyDaysAgoStr },
      optimizationMap: {},
      campaignObjects: [],
      today: { campaigns: [], adSets: [], ads: [], account: [], hourly: [] },
      yesterday: { campaigns: [], adSets: [], ads: [], account: [], hourly: [] },
      history: { accountDaily: [], campaignDaily: [], adsetDaily: [] },
      breakdowns: { ageGender: [], device: [], publisher: [] },
    };
  }
}

/**
 * Format an {@link AdContextData} object as a plain-text block for Claude.
 *
 * Produces sections for account totals, per-campaign breakdown (today vs yesterday),
 * ad set breakdown, ad breakdown, 30-day historical daily data, and audience breakdowns.
 * Uses the account's timezone when reporting the current time.
 *
 * @param data - Structured ad context from {@link fetchAdContextData}
 * @returns Multi-line plain text ready to be injected as Claude context
 */
export function formatContextForClaude(data: AdContextData): string {
  const sections: string[] = [];
  const optMap = data.optimizationMap;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: data.timezoneName,
  });
  const dayStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: data.timezoneName,
  });
  // Abbreviate the timezone to a human-readable label (e.g. "PT" for America/Los_Angeles)
  const tzAbbr = now
    .toLocaleTimeString('en-US', { timeZoneName: 'short', timeZone: data.timezoneName })
    .split(' ')
    .pop();

  sections.push(
    `CURRENT TIME: ${timeStr} ${tzAbbr} on ${dayStr}. Today's data is PARTIAL — the day is not over. Do not compare today's totals to yesterday's full-day totals as a "drop."\n`
  );

  // Account totals
  const todayAcct = data.today.account[0];
  const yesterdayAcct = data.yesterday.account[0];

  const todayCampaignResults = data.today.campaigns.reduce(
    (sum, c) => sum + getResultCount(c, c.campaign_id ?? '', optMap),
    0
  );
  const yesterdayCampaignResults = data.yesterday.campaigns.reduce(
    (sum, c) => sum + getResultCount(c, c.campaign_id ?? '', optMap),
    0
  );

  if (todayAcct) {
    const spend = parseFloat(todayAcct.spend);
    const costPerResult =
      todayCampaignResults > 0 ? (spend / todayCampaignResults).toFixed(2) : 'N/A';

    sections.push(
      `ACCOUNT TODAY: Spend $${spend.toFixed(2)}, Impressions ${todayAcct.impressions}, Clicks ${todayAcct.clicks}, CTR ${(parseFloat(todayAcct.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(todayAcct.cpc) || 0).toFixed(2)}, Results ${todayCampaignResults}, Cost/Result $${costPerResult}, CPM $${(parseFloat(todayAcct.cpm) || 0).toFixed(2)}`
    );
  }

  if (yesterdayAcct) {
    const spend = parseFloat(yesterdayAcct.spend);
    const costPerResult =
      yesterdayCampaignResults > 0 ? (spend / yesterdayCampaignResults).toFixed(2) : 'N/A';

    sections.push(
      `ACCOUNT YESTERDAY: Spend $${spend.toFixed(2)}, Impressions ${yesterdayAcct.impressions}, Clicks ${yesterdayAcct.clicks}, CTR ${(parseFloat(yesterdayAcct.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(yesterdayAcct.cpc) || 0).toFixed(2)}, Results ${yesterdayCampaignResults}, Cost/Result $${costPerResult}, CPM $${(parseFloat(yesterdayAcct.cpm) || 0).toFixed(2)}`
    );
  }

  // Campaign breakdown
  sections.push('\n--- CAMPAIGNS (TODAY vs YESTERDAY) ---');
  const allCampaignIds = new Set<string>();

  for (const c of [...data.today.campaigns, ...data.yesterday.campaigns]) {
    if (c.campaign_id) allCampaignIds.add(c.campaign_id);
  }

  const budgetMap: Record<string, string> = {};

  for (const c of data.campaignObjects) {
    if (c.daily_budget) budgetMap[c.id] = `$${(parseInt(c.daily_budget) / 100).toFixed(0)}`;
  }

  for (const cid of allCampaignIds) {
    const t = data.today.campaigns.find((c) => c.campaign_id === cid);
    const y = data.yesterday.campaigns.find((c) => c.campaign_id === cid);
    const name = t?.campaign_name ?? y?.campaign_name ?? cid;
    const dailyBudget = budgetMap[cid] ?? 'N/A';

    let line = `Campaign "${name}" (ID: ${cid}, Daily Budget: ${dailyBudget}):`;

    if (t) {
      const tResults = getResultCount(t, cid, optMap);
      const cpa = tResults > 0 ? (parseFloat(t.spend) / tResults).toFixed(2) : 'N/A';

      line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${tResults}, Cost/Result $${cpa}, Clicks ${t.clicks}, CTR ${(parseFloat(t.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(t.cpc) || 0).toFixed(2)}, Frequency ${t.frequency ?? 'N/A'}`;
    } else {
      line += ' TODAY: No data yet';
    }

    if (y) {
      const yResults = getResultCount(y, cid, optMap);
      const cpa = yResults > 0 ? (parseFloat(y.spend) / yResults).toFixed(2) : 'N/A';

      line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${yResults}, Cost/Result $${cpa}, Clicks ${y.clicks}, CTR ${(parseFloat(y.ctr) || 0).toFixed(2)}%`;
    } else {
      line += ' | YESTERDAY: No data';
    }

    sections.push(line);
  }

  // Ad Set breakdown
  if (data.today.adSets.length > 0 || data.yesterday.adSets.length > 0) {
    sections.push('\n--- AD SETS (TODAY vs YESTERDAY) ---');
    const allAdSetIds = new Set<string>();

    for (const a of [...data.today.adSets, ...data.yesterday.adSets]) {
      if (a.adset_id) allAdSetIds.add(a.adset_id);
    }

    for (const asid of allAdSetIds) {
      const t = data.today.adSets.find((a) => a.adset_id === asid);
      const y = data.yesterday.adSets.find((a) => a.adset_id === asid);
      const name = t?.adset_name ?? y?.adset_name ?? asid;
      let line = `Ad Set "${name}" (ID: ${asid}):`;

      if (t) {
        const tResults = getResultCount(t, t.campaign_id ?? '', optMap);

        line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${tResults}, Clicks ${t.clicks}, CTR ${(parseFloat(t.ctr) || 0).toFixed(2)}%`;
      }

      if (y) {
        const yResults = getResultCount(y, y.campaign_id ?? '', optMap);

        line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${yResults}, Clicks ${y.clicks}`;
      }

      sections.push(line);
    }
  }

  // Ad breakdown
  if (data.today.ads.length > 0 || data.yesterday.ads.length > 0) {
    sections.push('\n--- ADS (TODAY vs YESTERDAY) ---');
    const allAdIds = new Set<string>();

    for (const a of [...data.today.ads, ...data.yesterday.ads]) {
      if (a.ad_id) allAdIds.add(a.ad_id);
    }

    for (const adId of allAdIds) {
      const t = data.today.ads.find((a) => a.ad_id === adId);
      const y = data.yesterday.ads.find((a) => a.ad_id === adId);
      const name = t?.ad_name ?? y?.ad_name ?? adId;
      const cid = t?.campaign_id ?? y?.campaign_id ?? '';
      let line = `Ad "${name}" (ID: ${adId}, campaign ${cid}):`;

      if (t) {
        const tResults = getResultCount(t, cid, optMap);

        line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${tResults}, Clicks ${t.clicks}, CTR ${(parseFloat(t.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(t.cpc) || 0).toFixed(2)}`;
      } else {
        line += ' TODAY: No data';
      }

      if (y) {
        const yResults = getResultCount(y, cid, optMap);

        line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${yResults}, Clicks ${y.clicks}`;
      }

      sections.push(line);
    }
  }

  // Historical daily data
  if (data.history.accountDaily.length > 0) {
    sections.push('\n--- DAILY ACCOUNT PERFORMANCE (LAST 30 DAYS) ---');

    for (const row of data.history.accountDaily) {
      const results = getResultCount(row, row.campaign_id ?? '', optMap);

      sections.push(
        `${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Results ${results}, Clicks ${row.clicks}, CTR ${(parseFloat(row.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(row.cpc) || 0).toFixed(2)}`
      );
    }
  }

  // Audience breakdowns
  if (data.breakdowns.ageGender.length > 0) {
    sections.push('\n--- AUDIENCE BREAKDOWN (TODAY) ---');

    for (const row of data.breakdowns.ageGender) {
      sections.push(
        `${row.age ?? '?'} ${row.gender ?? '?'}: Spend $${parseFloat(row.spend).toFixed(2)}, Clicks ${row.clicks}, CTR ${(parseFloat(row.ctr) || 0).toFixed(2)}%`
      );
    }
  }

  return sections.join('\n');
}
