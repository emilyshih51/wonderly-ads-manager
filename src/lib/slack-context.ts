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
    const fetches = {
      todayCampaigns: meta.getCampaignLevelInsights('today'),
      yesterdayCampaigns: meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'campaign'),
      todayAdSets: meta.getAdSetLevelInsights('today'),
      yesterdayAdSets: meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'adset'),
      todayAds: meta.getAdLevelInsights('today'),
      yesterdayAds: meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'ad'),
      todayHourly: meta.getHourlyInsights('today', 'campaign'),
      yesterdayHourly: meta.getHourlyInsightsForDate(yesterdayStr, yesterdayStr, 'campaign'),
      todayAccount: meta.getAccountInsights('today'),
      yesterdayAccount: meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'account'),
      ageGender: meta.getInsightsWithBreakdowns('today', 'age,gender'),
      device: meta.getInsightsWithBreakdowns('today', 'device_platform'),
      publisher: meta.getInsightsWithBreakdowns('today', 'publisher_platform'),
      optimizationMap: meta.getCampaignOptimizationMap(),
      accountDaily: meta.getDailyInsights('last_30d', 'account'),
      campaignDaily: meta.getDailyInsights('last_30d', 'campaign'),
      adsetDaily: meta.getDailyInsights('last_7d', 'adset'),
      campaigns: meta.getCampaigns(),
      adAccount: meta.getAdAccount(),
    };

    const keys = Object.keys(fetches);
    const settled = await Promise.allSettled(Object.values(fetches));
    const data: Record<string, unknown> = {};

    settled.forEach((r, i) => {
      data[keys[i]] = r.status === 'fulfilled' ? r.value : null;
    });

    const extractRows = (key: string): MetaInsightsRow[] =>
      (data[key] as { data?: MetaInsightsRow[] })?.data ?? [];

    const optimizationMap = (data.optimizationMap as Record<string, string>) ?? {};

    const accountInfo = data.adAccount as { name?: string; timezone_name?: string } | null;

    const campaignObjects =
      (data.campaigns as { data?: Array<{ id: string; daily_budget?: string }> })?.data ?? [];

    return {
      accountName: accountInfo?.name ?? `Account ${adAccountId}`,
      timezoneName: accountInfo?.timezone_name ?? 'America/Los_Angeles',
      date: { today: todayStr, yesterday: yesterdayStr, thirtyDaysAgo: thirtyDaysAgoStr },
      optimizationMap,
      campaignObjects,
      today: {
        campaigns: extractRows('todayCampaigns'),
        adSets: extractRows('todayAdSets'),
        ads: extractRows('todayAds'),
        account: extractRows('todayAccount'),
        hourly: extractRows('todayHourly'),
      },
      yesterday: {
        campaigns: extractRows('yesterdayCampaigns'),
        adSets: extractRows('yesterdayAdSets'),
        ads: extractRows('yesterdayAds'),
        account: extractRows('yesterdayAccount'),
        hourly: extractRows('yesterdayHourly'),
      },
      history: {
        accountDaily: extractRows('accountDaily'),
        campaignDaily: extractRows('campaignDaily'),
        adsetDaily: extractRows('adsetDaily'),
      },
      breakdowns: {
        ageGender: extractRows('ageGender') as Array<
          MetaInsightsRow & { age?: string; gender?: string }
        >,
        device: extractRows('device'),
        publisher: extractRows('publisher'),
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
    `CURRENT TIME: ${timeStr} ${tzAbbr} on ${dayStr}. Today's data is PARTIAL — the day is not over. Do not compare today's totals to yesterday's full-day totals as a "drop."`,
    `DATA BOUNDARY: Everything below is the ONLY data you have. Do not reference any campaigns, ad sets, ads, or metrics not listed here. If something is not in this data, say "I don't have data on that."\n`
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

  // Pre-build Map lookups for O(1) access instead of O(n) .find() per iteration
  const todayCampaignMap = new Map(data.today.campaigns.map((c) => [c.campaign_id, c]));
  const yesterdayCampaignMap = new Map(data.yesterday.campaigns.map((c) => [c.campaign_id, c]));
  const todayAdSetMap = new Map(data.today.adSets.map((a) => [a.adset_id, a]));
  const yesterdayAdSetMap = new Map(data.yesterday.adSets.map((a) => [a.adset_id, a]));
  const todayAdMap = new Map(data.today.ads.map((a) => [a.ad_id, a]));
  const yesterdayAdMap = new Map(data.yesterday.ads.map((a) => [a.ad_id, a]));

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
    const t = todayCampaignMap.get(cid);
    const y = yesterdayCampaignMap.get(cid);
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
      const t = todayAdSetMap.get(asid);
      const y = yesterdayAdSetMap.get(asid);
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
      const t = todayAdMap.get(adId);
      const y = yesterdayAdMap.get(adId);
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
