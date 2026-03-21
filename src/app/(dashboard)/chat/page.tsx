'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  BarChart3,
  Lightbulb,
  RefreshCw,
  AlertTriangle,
  Zap,
  Pause,
  Play,
  ChevronRight,
  Check,
  X,
  Copy,
  MessageSquarePlus,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { createLogger } from '@/services/logger';

import { useTranslations } from 'next-intl';

const logger = createLogger('Chat');

/* ───── types ───── */
interface ActionPayload {
  type: string;
  id: string;
  name?: string;
  budget?: number;
}

interface ParsedAction {
  payload: ActionPayload;
  status: 'pending' | 'executing' | 'done' | 'error' | 'dismissed';
  result?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string; // text with action blocks stripped out
  actions?: ParsedAction[];
  timestamp: Date;
  isLoading?: boolean;
}

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  reach?: string;
  frequency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  cost_per_inline_link_click?: string;
  inline_link_clicks?: string;
  date_start: string;
  date_stop: string;
  // breakdown fields
  age?: string;
  gender?: string;
  device_platform?: string;
  publisher_platform?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string; // "00:00:00" - "23:00:00"
}

interface ChatData {
  date: { today: string; yesterday: string; thirtyDaysAgo?: string };
  optimizationMap?: Record<string, string>; // campaign_id → result action type
  today: {
    campaigns: InsightRow[];
    adSets: InsightRow[];
    ads: InsightRow[];
    account: InsightRow[];
    hourly?: InsightRow[];
  };
  yesterday: {
    campaigns: InsightRow[];
    adSets: InsightRow[];
    ads: InsightRow[];
    account: InsightRow[];
    hourly?: InsightRow[];
  };
  history?: {
    accountDaily: InsightRow[]; // one row per day, last 30 days
    campaignDaily: InsightRow[]; // one row per campaign per day, last 30 days
    adsetDaily: InsightRow[]; // one row per adset per day, last 7 days
    adDaily?: InsightRow[]; // one row per ad per day, last 7 days
  };
  breakdowns: { ageGender: InsightRow[]; device: InsightRow[]; publisher: InsightRow[] };
}

/* ───── helpers ───── */

/** Never count these as "results" — they inflate numbers */
const ENGAGEMENT_TYPES = new Set([
  'link_click',
  'landing_page_view',
  'page_engagement',
  'post_engagement',
  'post',
  'comment',
  'like',
  'photo_view',
  'video_view',
  'post_reaction',
  'onsite_conversion.post_save',
  'outbound_click',
  'social_click',
]);

/**
 * Find the conversion action for a row, using the optimization map when available.
 * `resultActionType` = the specific action type this campaign optimizes for.
 */
function findConversionAction(
  actions: Array<{ action_type: string; value: string }>,
  resultActionType?: string
): { action_type: string; value: string } | undefined {
  // If we know the campaign's specific optimization event, ONLY look for that
  if (resultActionType) {
    return actions.find((a) => a.action_type === resultActionType);
  }

  // Fallback: generic search for any conversion (used for account-level, breakdowns)
  return actions.find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.')) &&
      !ENGAGEMENT_TYPES.has(a.action_type)
  );
}

function getResults(row: InsightRow, resultActionType?: string): number {
  if (!row.actions) return 0;
  const found = findConversionAction(row.actions, resultActionType);

  return found ? parseInt(found.value) : 0;
}

function getResultType(row: InsightRow, resultActionType?: string): string {
  if (!row.actions) return 'N/A';
  const found = findConversionAction(row.actions, resultActionType);

  if (!found) return 'N/A';

  return found.action_type
    .replace('offsite_conversion.fb_pixel_', '')
    .replace('offsite_conversion.', '')
    .replace('onsite_conversion.', '');
}

function getCostPerResult(row: InsightRow, resultActionType?: string): string {
  // Try cost_per_action_type first
  if (row.cost_per_action_type) {
    const found = findConversionAction(row.cost_per_action_type, resultActionType);

    if (found) return parseFloat(found.value).toFixed(2);
  }

  // Fallback: calculate spend / results
  const results = getResults(row, resultActionType);

  if (results > 0) {
    return (parseFloat(row.spend) / results).toFixed(2);
  }

  return 'N/A';
}

function pctChange(current: number, previous: number): string {
  if (previous === 0 && current === 0) return '0%';
  if (previous === 0) return '+∞';
  const pct = (((current - previous) / previous) * 100).toFixed(1);

  return (current >= previous ? '+' : '') + pct + '%';
}

/* ───── build context string — helper functions ───── */

function buildAccountOverview(
  today: ChatData['today'],
  yesterday: ChatData['yesterday'],
  date: ChatData['date']
): string[] {
  const sections: string[] = [];
  const todayAcct = today.account[0];
  const yesterdayAcct = yesterday.account[0];

  sections.push(`=== ACCOUNT OVERVIEW (${date.today}) ===`);

  if (todayAcct) {
    const tSpend = parseFloat(todayAcct.spend);
    const tClicks = parseInt(todayAcct.clicks);
    const tImpr = parseInt(todayAcct.impressions);
    const tResults = getResults(todayAcct);
    const tCpc = todayAcct.cost_per_inline_link_click || todayAcct.cpc;

    sections.push(
      `Today: Spend $${tSpend.toFixed(2)}, Impressions ${tImpr}, Clicks ${tClicks}, CTR ${todayAcct.ctr}%, CPC (link click) $${tCpc}, CPM $${todayAcct.cpm}, Results ${tResults}, Cost/Result $${getCostPerResult(todayAcct)}, Result Type: ${getResultType(todayAcct)}`
    );

    if (yesterdayAcct) {
      const ySpend = parseFloat(yesterdayAcct.spend);
      const yClicks = parseInt(yesterdayAcct.clicks);
      const yImpr = parseInt(yesterdayAcct.impressions);
      const yResults = getResults(yesterdayAcct);
      const yCpc = yesterdayAcct.cost_per_inline_link_click || yesterdayAcct.cpc;

      sections.push(
        `Yesterday: Spend $${ySpend.toFixed(2)}, Impressions ${yImpr}, Clicks ${yClicks}, CTR ${yesterdayAcct.ctr}%, CPC (link click) $${yCpc}, CPM $${yesterdayAcct.cpm}, Results ${yResults}, Cost/Result $${getCostPerResult(yesterdayAcct)}`
      );
      sections.push(
        `Day-over-Day Changes: Spend ${pctChange(tSpend, ySpend)}, Impressions ${pctChange(tImpr, yImpr)}, Clicks ${pctChange(tClicks, yClicks)}, Results ${pctChange(tResults, yResults)}`
      );
    }
  } else {
    sections.push('Today: No account data yet (campaigns may not have started delivering).');
  }

  return sections;
}

function buildCampaignComparison(
  todayCampaignMap: Map<string | undefined, InsightRow>,
  yesterdayCampaignMap: Map<string | undefined, InsightRow>,
  campaignIds: Set<string | undefined>,
  rat: (campaignId?: string) => string | undefined
): string[] {
  const sections: string[] = [];

  sections.push('\n=== CAMPAIGNS: TODAY vs YESTERDAY ===');

  for (const cid of campaignIds) {
    const t = todayCampaignMap.get(cid);
    const y = yesterdayCampaignMap.get(cid);
    const name = t?.campaign_name || y?.campaign_name || cid;

    if (t && y) {
      const r = rat(cid);
      const tSpend = parseFloat(t.spend);
      const ySpend = parseFloat(y.spend);
      const tResults = getResults(t, r);
      const yResults = getResults(y, r);
      const tClicks = parseInt(t.clicks);
      const yClicks = parseInt(y.clicks);

      sections.push(
        `Campaign "${name}": TODAY Spend $${tSpend.toFixed(2)}, Results ${tResults}, Clicks ${tClicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc}, CPM $${t.cpm}, Cost/Result $${getCostPerResult(t, r)} | ` +
          `YESTERDAY Spend $${ySpend.toFixed(2)}, Results ${yResults}, Clicks ${yClicks}, CTR ${y.ctr}%, CPC $${y.cost_per_inline_link_click || y.cpc}, CPM $${y.cpm}, Cost/Result $${getCostPerResult(y, r)} | ` +
          `CHANGES: Spend ${pctChange(tSpend, ySpend)}, Results ${pctChange(tResults, yResults)}, Clicks ${pctChange(tClicks, yClicks)}`
      );
    } else if (t) {
      const r = rat(cid);

      sections.push(
        `Campaign "${name}": TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResults(t, r)}, Clicks ${t.clicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc} | YESTERDAY: No data`
      );
    } else if (y) {
      const r = rat(cid);

      sections.push(
        `Campaign "${name}": TODAY: No data yet | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResults(y, r)}, Clicks ${y.clicks}, CTR ${y.ctr}%`
      );
    }
  }

  return sections;
}

function buildAdSetComparison(
  todayAdSetMap: Map<string | undefined, InsightRow>,
  yesterdayAdSetMap: Map<string | undefined, InsightRow>,
  adsetIds: Set<string | undefined>,
  rat: (campaignId?: string) => string | undefined
): string[] {
  const sections: string[] = [];

  sections.push('\n=== AD SETS: TODAY vs YESTERDAY ===');

  for (const aid of adsetIds) {
    const t = todayAdSetMap.get(aid);
    const y = yesterdayAdSetMap.get(aid);
    const name = t?.adset_name || y?.adset_name || aid;
    const r = rat(t?.campaign_id || y?.campaign_id);

    if (t && y) {
      const tResults = getResults(t, r);
      const yResults = getResults(y, r);

      sections.push(
        `Ad Set "${name}": TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${tResults}, Clicks ${t.clicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc}, Cost/Result $${getCostPerResult(t, r)} | ` +
          `YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${yResults}, Clicks ${y.clicks}, CTR ${y.ctr}%, CPC $${y.cost_per_inline_link_click || y.cpc}, Cost/Result $${getCostPerResult(y, r)} | ` +
          `CHANGES: Results ${pctChange(tResults, yResults)}`
      );
    } else if (t) {
      sections.push(
        `Ad Set "${name}": TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResults(t, r)}, Clicks ${t.clicks}, CTR ${t.ctr}% | YESTERDAY: No data`
      );
    } else if (y) {
      sections.push(
        `Ad Set "${name}": TODAY: No data | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResults(y, r)}, Clicks ${y.clicks}`
      );
    }
  }

  return sections;
}

function buildAdComparison(
  todayAdMap: Map<string | undefined, InsightRow>,
  yesterdayAdMap: Map<string | undefined, InsightRow>,
  adIds: Set<string | undefined>,
  rat: (campaignId?: string) => string | undefined,
  history: ChatData['history']
): string[] {
  const sections: string[] = [];

  if (adIds.size > 0) {
    sections.push('\n=== INDIVIDUAL ADS: TODAY vs YESTERDAY ===');

    for (const adId of adIds) {
      const t = todayAdMap.get(adId);
      const y = yesterdayAdMap.get(adId);
      const name = t?.ad_name || y?.ad_name || adId;
      const cid = t?.campaign_id || y?.campaign_id;
      const r = rat(cid);

      let line = `Ad "${name}" (ID: ${adId}, campaign ${cid}):`;

      if (t) {
        line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResults(t, r)}, Clicks ${t.clicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc}, Cost/Result $${getCostPerResult(t, r)}`;
      } else {
        line += ' TODAY: No data';
      }

      if (y) {
        line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResults(y, r)}, Clicks ${y.clicks}, CTR ${y.ctr}%, Cost/Result $${getCostPerResult(y, r)}`;
      } else {
        line += ' | YESTERDAY: No data';
      }

      sections.push(line);
    }
  }

  // Ad-level 7-day history (for accurate multi-day totals)
  if (history?.adDaily && history.adDaily.length > 0) {
    sections.push('\n=== AD DAILY PERFORMANCE (LAST 7 DAYS) ===');
    // Group by ad_id, show totals
    const adHistMap = new Map<string, { name: string; rows: InsightRow[] }>();

    for (const row of history.adDaily) {
      const key = row.ad_id || 'unknown';

      if (!adHistMap.has(key)) adHistMap.set(key, { name: row.ad_name || key, rows: [] });
      adHistMap.get(key)!.rows.push(row);
    }

    for (const [_adId, { name, rows }] of adHistMap) {
      const totalSpend = rows.reduce((s, r) => s + parseFloat(r.spend || '0'), 0);
      const totalClicks = rows.reduce((s, r) => s + parseInt(r.clicks || '0'), 0);
      const cid = rows[0]?.campaign_id;
      const rType = rat(cid);
      const totalResults = rows.reduce((s, r) => s + getResults(r, rType), 0);
      const cpr = totalResults > 0 ? (totalSpend / totalResults).toFixed(2) : 'N/A';

      sections.push(
        `Ad "${name}" (7-day total): Spend $${totalSpend.toFixed(2)}, Results ${totalResults}, Clicks ${totalClicks}, Cost/Result $${cpr}`
      );
      // Daily breakdown
      const sorted = [...rows].sort((a, b) =>
        (a.date_start || '').localeCompare(b.date_start || '')
      );

      for (const row of sorted) {
        sections.push(
          `  ${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Results ${getResults(row, rType)}, Clicks ${row.clicks}`
        );
      }
    }
  }

  return sections;
}

function buildHourlyAnalysis(
  today: ChatData['today'],
  yesterday: ChatData['yesterday'],
  rat: (campaignId?: string) => string | undefined
): string[] {
  const sections: string[] = [];

  const formatHour = (h: string) => {
    const hourNum = parseInt(h?.split(':')[0] || '0');

    if (hourNum === 0) return '12am';
    if (hourNum < 12) return `${hourNum}am`;
    if (hourNum === 12) return '12pm';

    return `${hourNum - 12}pm`;
  };

  const getHourKey = (row: InsightRow) =>
    row.hourly_stats_aggregated_by_advertiser_time_zone || '00:00:00';

  const todayHourly = today.hourly || [];
  const yesterdayHourly = yesterday.hourly || [];

  if (todayHourly.length > 0 || yesterdayHourly.length > 0) {
    sections.push('\n=== HOUR-BY-HOUR COMPARISON: TODAY vs YESTERDAY (by campaign) ===');
    sections.push(
      'Format: Hour | TODAY: Spend/Results/Clicks/Impr/CTR/CPC | YESTERDAY: Spend/Results/Clicks/Impr/CTR/CPC | CHANGE'
    );

    const allCampaignIds = new Set([
      ...todayHourly.map((r) => r.campaign_id || 'unknown'),
      ...yesterdayHourly.map((r) => r.campaign_id || 'unknown'),
    ]);

    for (const cid of allCampaignIds) {
      const r = rat(cid);
      const todayRows = todayHourly.filter((row) => (row.campaign_id || 'unknown') === cid);
      const yesterdayRows = yesterdayHourly.filter((row) => (row.campaign_id || 'unknown') === cid);
      const campaignName = todayRows[0]?.campaign_name || yesterdayRows[0]?.campaign_name || cid;

      const todayByHour: Record<string, InsightRow> = {};

      for (const row of todayRows) todayByHour[getHourKey(row)] = row;
      const yesterdayByHour: Record<string, InsightRow> = {};

      for (const row of yesterdayRows) yesterdayByHour[getHourKey(row)] = row;

      const allHours = [
        ...new Set([...Object.keys(todayByHour), ...Object.keys(yesterdayByHour)]),
      ].sort();

      sections.push(`\nCampaign "${campaignName}":`);

      let tTotalSpend = 0,
        tTotalResults = 0,
        tTotalClicks = 0;
      let yTotalSpend = 0,
        yTotalResults = 0,
        yTotalClicks = 0;

      for (const hour of allHours) {
        const t = todayByHour[hour];
        const y = yesterdayByHour[hour];
        const hLabel = formatHour(hour);

        const tSpend = t ? parseFloat(t.spend) : 0;
        const tResults = t ? getResults(t, r) : 0;
        const tClicks = t ? parseInt(t.clicks) : 0;
        const tImpr = t ? parseInt(t.impressions) : 0;
        const tCpc = t?.cost_per_inline_link_click || t?.cpc || '0';

        const ySpend = y ? parseFloat(y.spend) : 0;
        const yResults = y ? getResults(y, r) : 0;
        const yClicks = y ? parseInt(y.clicks) : 0;
        const yImpr = y ? parseInt(y.impressions) : 0;
        const yCpc = y?.cost_per_inline_link_click || y?.cpc || '0';

        tTotalSpend += tSpend;
        tTotalResults += tResults;
        tTotalClicks += tClicks;
        yTotalSpend += ySpend;
        yTotalResults += yResults;
        yTotalClicks += yClicks;

        if (t && y) {
          const spendDelta = ySpend > 0 ? pctChange(tSpend, ySpend) : tSpend > 0 ? 'new' : '';
          const resultsDelta =
            yResults > 0 ? pctChange(tResults, yResults) : tResults > 0 ? 'new' : '';

          sections.push(
            `  ${hLabel}: TODAY $${tSpend.toFixed(2)} spend, ${tResults} results, ${tClicks} clicks, ${tImpr} impr, CTR ${t.ctr}%, CPC $${tCpc} | ` +
              `YESTERDAY $${ySpend.toFixed(2)} spend, ${yResults} results, ${yClicks} clicks, ${yImpr} impr, CTR ${y.ctr}%, CPC $${yCpc} | ` +
              `Δ spend ${spendDelta}, results ${resultsDelta}`
          );
        } else if (t) {
          sections.push(
            `  ${hLabel}: TODAY $${tSpend.toFixed(2)} spend, ${tResults} results, ${tClicks} clicks, ${tImpr} impr, CTR ${t.ctr}%, CPC $${tCpc} | YESTERDAY: no data`
          );
        } else if (y) {
          sections.push(
            `  ${hLabel}: TODAY: no data yet | YESTERDAY $${ySpend.toFixed(2)} spend, ${yResults} results, ${yClicks} clicks, ${yImpr} impr, CTR ${y.ctr}%, CPC $${yCpc}`
          );
        }
      }

      const spendChg = yTotalSpend > 0 ? pctChange(tTotalSpend, yTotalSpend) : 'N/A';
      const resultsChg = yTotalResults > 0 ? pctChange(tTotalResults, yTotalResults) : 'N/A';

      sections.push(
        `  HOURLY TOTALS: TODAY $${tTotalSpend.toFixed(2)} spend / ${tTotalResults} results / ${tTotalClicks} clicks | ` +
          `YESTERDAY $${yTotalSpend.toFixed(2)} spend / ${yTotalResults} results / ${yTotalClicks} clicks | ` +
          `Δ spend ${spendChg}, results ${resultsChg}`
      );
    }
  }

  return sections;
}

function buildBreakdowns(breakdowns: ChatData['breakdowns']): string[] {
  const sections: string[] = [];

  if (breakdowns.ageGender.length > 0) {
    sections.push('\n=== AGE & GENDER BREAKDOWN (TODAY) ===');

    for (const row of breakdowns.ageGender) {
      sections.push(
        `${row.age || '?'} ${row.gender || '?'}: Spend $${parseFloat(row.spend).toFixed(2)}, Clicks ${row.clicks}, CTR ${row.ctr}%, Results ${getResults(row)}`
      );
    }
  }

  if (breakdowns.device.length > 0) {
    sections.push('\n=== DEVICE BREAKDOWN (TODAY) ===');

    for (const row of breakdowns.device) {
      sections.push(
        `${row.device_platform || '?'}: Spend $${parseFloat(row.spend).toFixed(2)}, Clicks ${row.clicks}, CTR ${row.ctr}%, Results ${getResults(row)}`
      );
    }
  }

  if (breakdowns.publisher.length > 0) {
    sections.push('\n=== PUBLISHER PLATFORM BREAKDOWN (TODAY) ===');

    for (const row of breakdowns.publisher) {
      sections.push(
        `${row.publisher_platform || '?'}: Spend $${parseFloat(row.spend).toFixed(2)}, Clicks ${row.clicks}, CTR ${row.ctr}%, Results ${getResults(row)}`
      );
    }
  }

  return sections;
}

function buildHistoricalTrends(
  history: ChatData['history'],
  rat: (campaignId?: string) => string | undefined
): string[] {
  const sections: string[] = [];

  if (!history) return sections;

  // Account-level daily totals (last 30 days)
  if (history.accountDaily.length > 0) {
    sections.push('\n=== DAILY ACCOUNT PERFORMANCE (LAST 30 DAYS) ===');
    sections.push('Date | Spend | Impressions | Clicks | CTR | CPC | CPM | Results | Cost/Result');
    const sorted = [...history.accountDaily].sort((a, b) =>
      a.date_start.localeCompare(b.date_start)
    );

    for (const row of sorted) {
      const results = getResults(row);
      const cpr = getCostPerResult(row);
      const cpc = row.cost_per_inline_link_click || row.cpc;

      sections.push(
        `${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Impr ${row.impressions}, Clicks ${row.clicks}, CTR ${row.ctr}%, CPC $${cpc}, CPM $${row.cpm}, Results ${results}, Cost/Result $${cpr}`
      );
    }

    const last7 = sorted.slice(-7);
    const last14 = sorted.slice(-14);
    const avg = (rows: InsightRow[], field: 'spend' | 'clicks' | 'impressions') =>
      rows.reduce((sum, r) => sum + parseFloat(r[field] || '0'), 0) / (rows.length || 1);
    const avgResults = (rows: InsightRow[]) =>
      rows.reduce((sum, r) => sum + getResults(r), 0) / (rows.length || 1);

    if (last7.length >= 7) {
      sections.push(
        `\n7-Day Averages: Spend $${avg(last7, 'spend').toFixed(2)}/day, Clicks ${avg(last7, 'clicks').toFixed(0)}/day, Impr ${avg(last7, 'impressions').toFixed(0)}/day, Results ${avgResults(last7).toFixed(1)}/day`
      );
    }

    if (last14.length >= 14) {
      sections.push(
        `14-Day Averages: Spend $${avg(last14, 'spend').toFixed(2)}/day, Clicks ${avg(last14, 'clicks').toFixed(0)}/day, Impr ${avg(last14, 'impressions').toFixed(0)}/day, Results ${avgResults(last14).toFixed(1)}/day`
      );
    }

    const all30 = sorted;

    if (all30.length >= 20) {
      sections.push(
        `30-Day Averages: Spend $${avg(all30, 'spend').toFixed(2)}/day, Clicks ${avg(all30, 'clicks').toFixed(0)}/day, Impr ${avg(all30, 'impressions').toFixed(0)}/day, Results ${avgResults(all30).toFixed(1)}/day`
      );
    }
  }

  // Campaign-level daily data (last 30 days) — grouped by campaign
  if (history.campaignDaily.length > 0) {
    sections.push('\n=== DAILY CAMPAIGN PERFORMANCE (LAST 30 DAYS) ===');
    const byCampaign: Record<string, InsightRow[]> = {};

    for (const row of history.campaignDaily) {
      const key = row.campaign_id || 'unknown';

      if (!byCampaign[key]) byCampaign[key] = [];
      byCampaign[key].push(row);
    }

    for (const [cid, rows] of Object.entries(byCampaign)) {
      const sorted = rows.sort((a, b) => a.date_start.localeCompare(b.date_start));
      const name = sorted[0]?.campaign_name || cid;
      const r = rat(cid);

      sections.push(`\nCampaign "${name}" daily:`);

      for (const row of sorted) {
        const results = getResults(row, r);
        const cpr = getCostPerResult(row, r);

        sections.push(
          `  ${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Results ${results}, Clicks ${row.clicks}, CTR ${row.ctr}%, CPC $${row.cost_per_inline_link_click || row.cpc}, Cost/Result $${cpr}`
        );
      }
    }
  }

  // Ad-set daily data (last 7 days) — summarized
  if (history.adsetDaily.length > 0) {
    sections.push('\n=== DAILY AD SET PERFORMANCE (LAST 7 DAYS) ===');
    const byAdset: Record<string, InsightRow[]> = {};

    for (const row of history.adsetDaily) {
      const key = row.adset_id || 'unknown';

      if (!byAdset[key]) byAdset[key] = [];
      byAdset[key].push(row);
    }

    for (const [aid, rows] of Object.entries(byAdset)) {
      const sorted = rows.sort((a, b) => a.date_start.localeCompare(b.date_start));
      const name = sorted[0]?.adset_name || aid;
      const r = rat(sorted[0]?.campaign_id);

      sections.push(`\nAd Set "${name}" daily:`);

      for (const row of sorted) {
        const results = getResults(row, r);
        const cpr = getCostPerResult(row, r);

        sections.push(
          `  ${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Results ${results}, Clicks ${row.clicks}, CTR ${row.ctr}%, Cost/Result $${cpr}`
        );
      }
    }
  }

  return sections;
}

/* ───── build context string ───── */
function buildRichContext(data: ChatData): string {
  const { today, yesterday, breakdowns, date, optimizationMap, history } = data;
  const optMap = optimizationMap || {};

  // Tell Claude what time it is so it knows today's data is partial
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const dayStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const sections: string[] = [];

  sections.push(
    `CURRENT TIME: ${timeStr} on ${dayStr}. Today's data is PARTIAL — the day is not over. Do not compare today's totals to yesterday's full-day totals as a "drop."\n`
  );

  // Helper to look up result action type for a campaign
  const rat = (campaignId?: string) => (campaignId ? optMap[campaignId] : undefined);

  // Pre-build Map lookups for O(1) access instead of O(n) .find() loops
  const todayCampaignMap = new Map(today.campaigns.map((c) => [c.campaign_id, c]));
  const yesterdayCampaignMap = new Map(yesterday.campaigns.map((c) => [c.campaign_id, c]));
  const todayAdSetMap = new Map(today.adSets.map((a) => [a.adset_id, a]));
  const yesterdayAdSetMap = new Map(yesterday.adSets.map((a) => [a.adset_id, a]));
  const todayAdMap = new Map(today.ads.map((a) => [a.ad_id, a]));
  const yesterdayAdMap = new Map(yesterday.ads.map((a) => [a.ad_id, a]));

  const campaignIds = new Set([
    ...today.campaigns.map((c) => c.campaign_id),
    ...yesterday.campaigns.map((c) => c.campaign_id),
  ]);
  const adsetIds = new Set([
    ...today.adSets.map((a) => a.adset_id),
    ...yesterday.adSets.map((a) => a.adset_id),
  ]);
  const adIds = new Set([...today.ads.map((a) => a.ad_id), ...yesterday.ads.map((a) => a.ad_id)]);

  sections.push(...buildAccountOverview(today, yesterday, date));
  sections.push(
    ...buildCampaignComparison(todayCampaignMap, yesterdayCampaignMap, campaignIds, rat)
  );
  sections.push(...buildAdSetComparison(todayAdSetMap, yesterdayAdSetMap, adsetIds, rat));
  sections.push(...buildAdComparison(todayAdMap, yesterdayAdMap, adIds, rat, history));
  sections.push(...buildHourlyAnalysis(today, yesterday, rat));
  sections.push(...buildBreakdowns(breakdowns));
  sections.push(...buildHistoricalTrends(history, rat));

  return sections.join('\n');
}

/* ───── suggested prompts ───── */
const SUGGESTED_PROMPTS = [
  {
    icon: AlertTriangle,
    labelKey: 'promptLowConversions',
    color: 'red',
    prompt:
      'Why are my conversions low today compared to yesterday? Break it down by campaign and tell me exactly what changed.',
  },
  {
    icon: TrendingDown,
    labelKey: 'promptLeadQuality',
    color: 'orange',
    prompt:
      'Are we getting fewer or worse leads today vs yesterday? Which ad sets are underperforming and why?',
  },
  {
    icon: TrendingUp,
    labelKey: 'promptOverview',
    color: 'blue',
    prompt:
      'Give me a comprehensive performance overview — today vs yesterday, including key metrics changes and what stands out.',
  },
  {
    icon: DollarSign,
    labelKey: 'promptCostAnalysis',
    color: 'green',
    prompt:
      'Analyze my cost efficiency. Where am I wasting budget? Which campaigns have the best and worst cost per result?',
  },
  {
    icon: Target,
    labelKey: 'promptScale',
    color: 'purple',
    prompt:
      'Based on the hourly data today vs yesterday, which campaigns/ad sets should I scale up and which should I pause? Be specific.',
  },
  {
    icon: Lightbulb,
    labelKey: 'promptOptimization',
    color: 'indigo',
    prompt:
      'Give me a prioritized list of 5 specific actions I should take right now to improve my ad performance, based on the data.',
  },
  {
    icon: BarChart3,
    labelKey: 'promptAudience',
    color: 'teal',
    prompt:
      'Analyze my audience breakdown — which age groups, genders, devices, and platforms are performing best? Any surprises?',
  },
  {
    icon: Zap,
    labelKey: 'promptDiagnosis',
    color: 'yellow',
    prompt:
      'Run a quick health check on my ad account. Flag anything unusual — rising costs, dropping CTR, spending without results, etc.',
  },
];

/** Hex colors per prompt category — rendered via inline styles to work in both themes. */
const COLOR_HEX: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#8b5cf6',
  indigo: '#6366f1',
  teal: '#14b8a6',
  yellow: '#eab308',
};

/* ───── action helpers ───── */
const ACTION_RE = /:::action(\{.*?\}):::/g;

function parseActionsFromReply(raw: string): { content: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const content = raw
    .replace(ACTION_RE, (_, json) => {
      try {
        const payload = JSON.parse(json) as ActionPayload;

        if (payload.type && payload.id) {
          actions.push({ payload, status: 'pending' });
        }
      } catch {
        /* ignore malformed */
      }

      return ''; // strip from visible text
    })
    .trim();

  return { content, actions };
}

function actionLabel(a: ActionPayload, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    pause_campaign: t('actionPauseCampaign'),
    resume_campaign: t('actionResumeCampaign'),
    pause_ad_set: t('actionPauseAdSet'),
    resume_ad_set: t('actionResumeAdSet'),
    pause_ad: t('actionPauseAd'),
    resume_ad: t('actionResumeAd'),
    adjust_budget: t('actionAdjustBudget'),
  };

  return labels[a.type] || a.type;
}

function actionIcon(type: string) {
  if (type.startsWith('pause')) return Pause;
  if (type.startsWith('resume')) return Play;
  if (type === 'adjust_budget') return DollarSign;

  return ChevronRight;
}

function actionColor(type: string): { border: string; bg: string } {
  if (type.startsWith('pause')) return { border: '#f97316', bg: '#f97316' };
  if (type.startsWith('resume')) return { border: '#22c55e', bg: '#22c55e' };
  if (type === 'adjust_budget') return { border: '#3b82f6', bg: '#3b82f6' };

  return { border: '', bg: '' };
}

const FOLLOW_UP_PROMPTS = [
  { labelKey: 'followUpAdvice', prompt: 'What should I do about this?' },
  { labelKey: 'followUpBreakdown', prompt: 'Break it down by ad set' },
  { labelKey: 'followUpPause', prompt: 'Which ads should I pause?' },
  { labelKey: 'followUpCompare', prompt: 'Compare to last 7 days' },
];

/* ───── main component ───── */
export default function ChatPage() {
  const t = useTranslations('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const resetChat = useCallback(() => {
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }, []);

  const copyMessage = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /* Fetch comprehensive data */
  const fetchData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);

    try {
      const res = await fetch('/api/chat/data');

      if (!res.ok) throw new Error('Failed to load data');
      const data = await res.json();

      setChatData(data);
    } catch (err) {
      logger.error('Failed to load chat data', err);
      setDataError('Could not load account data. Make sure you are logged in.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* Data stats for UI */
  const dataStats = chatData
    ? {
        campaigns: new Set([
          ...chatData.today.campaigns.map((c) => c.campaign_id),
          ...chatData.yesterday.campaigns.map((c) => c.campaign_id),
        ]).size,
        adSets: new Set([
          ...chatData.today.adSets.map((a) => a.adset_id),
          ...chatData.yesterday.adSets.map((a) => a.adset_id),
        ]).size,
        ads: chatData.today.ads.length,
        hasYesterday: chatData.yesterday.campaigns.length > 0,
        hasHourly: (chatData.today.hourly?.length || 0) > 0,
        hasBreakdowns: chatData.breakdowns.ageGender.length > 0,
        hasHistory: (chatData.history?.accountDaily?.length || 0) > 0,
        historyDays: chatData.history?.accountDaily?.length || 0,
      }
    : null;

  /* Execute an approved action */
  const executeAction = async (msgId: string, actionIdx: number) => {
    // Mark as executing
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.actions) return m;
        const newActions = [...m.actions];

        newActions[actionIdx] = { ...newActions[actionIdx], status: 'executing' };

        return { ...m, actions: newActions };
      })
    );

    const msg = messages.find((m) => m.id === msgId);
    const action = msg?.actions?.[actionIdx];

    if (!action) return;

    try {
      const res = await fetch('/api/chat/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.payload }),
      });
      const data = await res.json();

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.actions) return m;
          const newActions = [...m.actions];

          newActions[actionIdx] = {
            ...newActions[actionIdx],
            status: data.success ? 'done' : 'error',
            result: data.result || data.error || 'Unknown error',
          };

          return { ...m, actions: newActions };
        })
      );

      // Refresh data after successful action
      if (data.success) fetchData();
    } catch {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.actions) return m;
          const newActions = [...m.actions];

          newActions[actionIdx] = {
            ...newActions[actionIdx],
            status: 'error',
            result: 'Network error',
          };

          return { ...m, actions: newActions };
        })
      );
    }
  };

  const dismissAction = (msgId: string, actionIdx: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.actions) return m;
        const newActions = [...m.actions];

        newActions[actionIdx] = { ...newActions[actionIdx], status: 'dismissed' };

        return { ...m, actions: newActions };
      })
    );
  };

  /* Send message */
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    const loadingMsg: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const context = chatData
        ? buildRichContext(chatData)
        : "No account data available — user may not be logged in or data hasn't loaded yet.";
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          context,
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error('Failed to send message');

      // Handle streaming response
      const reader = res.body?.getReader();

      if (!reader) throw new Error('No response body');

      let fullContent = '';
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();

              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);

                if (parsed.text) {
                  fullContent += parsed.text;
                  // Update message incrementally with streaming text
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === loadingMsg.id ? { ...m, content: fullContent, isLoading: true } : m
                    )
                  );
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Parse actions from completed response
      const { content, actions } = parseActionsFromReply(fullContent);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? {
                ...m,
                content,
                actions: actions.length > 0 ? actions : undefined,
                isLoading: false,
              }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, content: 'Network error. Please try again.', isLoading: false }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  /* Format message content with markdown-like rendering */
  const formatContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      if (line.startsWith('#### '))
        return (
          <h5
            key={i}
            className="mt-4 mb-1 text-xs font-semibold tracking-wider text-[var(--color-muted-foreground)] uppercase"
          >
            {line.slice(5)}
          </h5>
        );
      if (line.startsWith('### '))
        return (
          <h4 key={i} className="mt-3 mb-1 text-sm font-semibold">
            {line.slice(4)}
          </h4>
        );
      if (line.startsWith('## '))
        return (
          <h3 key={i} className="mt-4 mb-1 text-base font-bold">
            {line.slice(3)}
          </h3>
        );
      if (line.startsWith('# '))
        return (
          <h2 key={i} className="mt-4 mb-2 text-lg font-bold">
            {line.slice(2)}
          </h2>
        );
      if (line.trim() === '---' || line.trim() === '***')
        return <hr key={i} className="my-3 border-[var(--color-border)]" />;

      let html = line
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');

      html = html.replace(
        /`([^`]+)`/g,
        '<code class="bg-[var(--color-muted)] px-1 py-0.5 rounded text-xs font-mono">$1</code>'
      );
      html = html.replace(/(\$[\d,.]+)/g, '<span class="font-semibold">$1</span>');
      html = html.replace(
        /(↑[\d.]+%|↑\d+)/g,
        '<span class="font-semibold text-green-600 dark:text-green-400">$1</span>'
      );
      html = html.replace(
        /(↓[\d.]+%|↓\d+)/g,
        '<span class="font-semibold text-red-600 dark:text-red-400">$1</span>'
      );

      if (line.startsWith('- ') || line.startsWith('• '))
        return (
          <li
            key={i}
            className="ml-4 list-disc text-sm"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html.slice(2)) }}
          />
        );

      const numMatch = line.match(/^(\d+)\.\s/);

      if (numMatch)
        return (
          <li
            key={i}
            className="ml-4 list-decimal text-sm"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html.slice(numMatch[0].length)) }}
          />
        );

      if (!line.trim()) return <br key={i} />;

      html = html
        .replace(
          /Confidence:\s*High/gi,
          '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">Confidence: High</span>'
        )
        .replace(
          /Confidence:\s*Medium/gi,
          '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400">Confidence: Medium</span>'
        )
        .replace(
          /Confidence:\s*Low/gi,
          '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">Confidence: Low</span>'
        );

      return (
        <p
          key={i}
          className="text-sm"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
      );
    });
  };

  /* Render action card */
  const renderActionCard = (action: ParsedAction, msgId: string, idx: number) => {
    const Icon = actionIcon(action.payload.type);
    const colors = actionColor(action.payload.type);
    const label = actionLabel(action.payload, t);
    const name = action.payload.name || action.payload.id;
    const budgetStr = action.payload.budget ? ` → $${action.payload.budget.toFixed(2)}/day` : '';

    if (action.status === 'dismissed') return null;

    return (
      <div
        key={idx}
        className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5 transition-all"
        style={
          colors.bg
            ? { backgroundColor: `${colors.bg}10`, borderColor: `${colors.border}30` }
            : undefined
        }
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-[var(--color-muted-foreground)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
            {label}: {name}
            {budgetStr}
          </p>
          {action.result && (
            <p
              className="mt-0.5 text-xs"
              style={{ color: action.status === 'error' ? '#ef4444' : '#22c55e' }}
            >
              {action.result}
            </p>
          )}
        </div>
        {action.status === 'pending' && (
          <div className="flex flex-shrink-0 gap-1.5">
            <Button size="sm" onClick={() => executeAction(msgId, idx)}>
              <Check className="mr-1 h-3 w-3" /> {t('approve')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => dismissAction(msgId, idx)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {action.status === 'executing' && (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" style={{ color: '#3b82f6' }} />
        )}
        {action.status === 'done' && (
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: '#22c55e18', color: '#22c55e' }}
          >
            <Check className="h-3.5 w-3.5" />
          </div>
        )}
        {action.status === 'error' && (
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: '#ef444418', color: '#ef4444' }}
          >
            <X className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    );
  };

  const lastMsg = messages[messages.length - 1];
  const showFollowUps = lastMsg?.role === 'assistant' && !lastMsg.isLoading && !isLoading;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-[100dvh]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8 md:py-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-[var(--color-foreground)] md:text-xl">
            {t('title')}
          </h1>
          <p className="mt-0.5 hidden text-sm text-[var(--color-muted-foreground)] sm:block">
            {t('description')}
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={resetChat} className="shrink-0">
            <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('newChat')}</span>
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 md:px-8 md:py-12">
            <div className="mb-10 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-blue-500 to-purple-600 md:h-16 md:w-16">
                <Sparkles className="h-7 w-7 text-white md:h-8 md:w-8" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-[var(--color-foreground)] md:text-2xl">
                {t('askAnything')}
              </h2>
              <p className="mx-auto max-w-lg text-sm text-[var(--color-muted-foreground)] md:text-base">
                {t('poweredBy')}
              </p>

              {dataLoading && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('loadingAccountData')}
                </div>
              )}
              {dataError && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" /> {dataError}
                </div>
              )}
              {!dataLoading && dataStats && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted-foreground)]">
                  <span>{t('nCampaigns', { count: dataStats.campaigns })}</span>
                  <span className="hidden sm:inline">·</span>
                  <span>{t('nAdSets', { count: dataStats.adSets })}</span>
                  <span className="hidden sm:inline">·</span>
                  <span>{t('nAds', { count: dataStats.ads })}</span>
                  {dataStats.hasYesterday && (
                    <span className="text-green-600 dark:text-green-400">
                      ✓ {t('yesterdayCheck')}
                    </span>
                  )}
                  {dataStats.hasHourly && (
                    <span className="text-green-600 dark:text-green-400">✓ {t('hourlyCheck')}</span>
                  )}
                  {dataStats.hasBreakdowns && (
                    <span className="text-green-600 dark:text-green-400">
                      ✓ {t('breakdownsCheck')}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {SUGGESTED_PROMPTS.map((prompt, idx) => {
                const Icon = prompt.icon;
                const hex = COLOR_HEX[prompt.color] || COLOR_HEX.blue;

                return (
                  <button
                    key={idx}
                    onClick={() => sendMessage(prompt.prompt)}
                    disabled={isLoading || dataLoading}
                    className="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3.5 text-left transition-all hover:bg-[var(--color-muted)] disabled:opacity-50 sm:p-4"
                  >
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9"
                      style={{ backgroundColor: `${hex}18`, color: hex }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">
                        {t(prompt.labelKey)}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                        {prompt.prompt}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-4 sm:px-6 sm:py-6 md:px-8">
            {messages.map((msg) => (
              <div key={msg.id}>
                <div className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-purple-600 sm:h-8 sm:w-8">
                      <Bot className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" />
                    </div>
                  )}
                  <div
                    className={`group/msg relative max-w-[90%] sm:max-w-[85%] ${
                      msg.role === 'user'
                        ? 'rounded-2xl rounded-tr-md bg-[var(--color-primary)] px-4 py-3 text-[var(--color-primary-foreground)]'
                        : 'rounded-2xl rounded-tl-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3.5 sm:px-5 sm:py-4'
                    }`}
                  >
                    {/* Copy button — assistant messages only */}
                    {msg.role === 'assistant' && !msg.isLoading && msg.content && (
                      <button
                        onClick={() => copyMessage(msg.id, msg.content)}
                        className="absolute -top-2 -right-2 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 opacity-0 shadow-sm transition-opacity group-hover/msg:opacity-100"
                        aria-label={t('copyMessage')}
                      >
                        {copiedId === msg.id ? (
                          <Check className="h-3 w-3 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                        )}
                      </button>
                    )}

                    {/* Content */}
                    {msg.isLoading && !msg.content ? (
                      <div className="flex items-center gap-2">
                        <span className="flex gap-1">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:0ms]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:150ms]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--color-muted-foreground)] [animation-delay:300ms]" />
                        </span>
                      </div>
                    ) : (
                      <>
                        <div
                          className={`space-y-1 text-sm leading-relaxed ${msg.role === 'user' ? 'text-[var(--color-primary-foreground)]' : 'text-[var(--color-foreground)]'}`}
                        >
                          {formatContent(msg.content)}
                          {msg.isLoading && (
                            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-full bg-[var(--color-primary)] align-middle" />
                          )}
                        </div>
                        {!msg.isLoading && msg.actions && msg.actions.length > 0 && (
                          <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-3">
                            <p className="flex items-center gap-1 text-xs font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase">
                              <Zap className="h-3 w-3" /> {t('suggestedActions')}
                            </p>
                            {msg.actions.map((action, idx) =>
                              renderActionCard(action, msg.id, idx)
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-muted)] sm:h-8 sm:w-8">
                      <User className="h-3.5 w-3.5 text-[var(--color-muted-foreground)] sm:h-4 sm:w-4" />
                    </div>
                  )}
                </div>
                {/* Timestamp */}
                <p
                  className={`mt-1 text-[10px] text-[var(--color-muted-foreground)] ${
                    msg.role === 'user' ? 'mr-10 text-right sm:mr-11' : 'ml-10 sm:ml-11'
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            ))}

            {/* Follow-up suggestions */}
            {showFollowUps && (
              <div className="ml-10 flex flex-wrap gap-1.5 sm:ml-11">
                {FOLLOW_UP_PROMPTS.map((p) => (
                  <button
                    key={p.labelKey}
                    onClick={() => sendMessage(p.prompt)}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-xs text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 sm:px-6 md:px-8 md:py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('inputPlaceholder')}
              className="max-h-[120px] min-h-[44px] w-full resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] py-3 pr-12 pl-12 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-transparent focus:ring-2 focus:ring-[var(--color-primary)] focus:outline-none sm:pr-12 sm:pl-12"
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={fetchData}
              disabled={dataLoading}
              title={t('refreshData')}
              className="absolute top-3 left-3 rounded-md p-1 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${dataLoading ? 'animate-spin' : ''}`} />
            </button>
            <Button
              size="icon"
              className="absolute top-1.5 right-2 h-8 w-8 rounded-lg"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 hidden text-center text-[10px] text-[var(--color-muted-foreground)] sm:block">
            Powered by Claude · Live Meta Ads data
          </p>
        </div>
      </div>
    </div>
  );
}
