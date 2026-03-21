'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Target,
  BarChart3,
  Lightbulb,
  Zap,
  Pause,
  Play,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { useTranslations } from 'next-intl';
import { createLogger } from '@/services/logger';

const logger = createLogger('ChatEngine');

/* ───── types ───── */

export interface ActionPayload {
  type: string;
  id: string;
  name?: string;
  budget?: number;
}

export interface ParsedAction {
  payload: ActionPayload;
  status: 'pending' | 'executing' | 'done' | 'error' | 'dismissed';
  result?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  /** Text content with action blocks stripped out. */
  content: string;
  actions?: ParsedAction[];
  timestamp: Date;
  isLoading?: boolean;
}

export interface InsightRow {
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
  age?: string;
  gender?: string;
  device_platform?: string;
  publisher_platform?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
}

export interface ChatData {
  date: { today: string; yesterday: string; thirtyDaysAgo?: string };
  optimizationMap?: Record<string, string>;
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
    accountDaily: InsightRow[];
    campaignDaily: InsightRow[];
    adsetDaily: InsightRow[];
    adDaily?: InsightRow[];
  };
  breakdowns: { ageGender: InsightRow[]; device: InsightRow[]; publisher: InsightRow[] };
}

/* ───── helpers ───── */

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

function findConversionAction(
  actions: Array<{ action_type: string; value: string }>,
  resultActionType?: string
): { action_type: string; value: string } | undefined {
  if (resultActionType) {
    return actions.find((a) => a.action_type === resultActionType);
  }
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
  if (row.cost_per_action_type) {
    const found = findConversionAction(row.cost_per_action_type, resultActionType);
    if (found) return parseFloat(found.value).toFixed(2);
  }
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

/* ───── context builders ───── */

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

  if (history?.adDaily && history.adDaily.length > 0) {
    sections.push('\n=== AD DAILY PERFORMANCE (LAST 7 DAYS) ===');
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
      const yesterdayRows = yesterdayHourly.filter(
        (row) => (row.campaign_id || 'unknown') === cid
      );
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

/** Build the full rich context string to send to the AI. */
export function buildRichContext(data: ChatData): string {
  const { today, yesterday, breakdowns, date, optimizationMap, history } = data;
  const optMap = optimizationMap || {};

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

  const rat = (campaignId?: string) => (campaignId ? optMap[campaignId] : undefined);

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
  sections.push(...buildCampaignComparison(todayCampaignMap, yesterdayCampaignMap, campaignIds, rat));
  sections.push(...buildAdSetComparison(todayAdSetMap, yesterdayAdSetMap, adsetIds, rat));
  sections.push(...buildAdComparison(todayAdMap, yesterdayAdMap, adIds, rat, history));
  sections.push(...buildHourlyAnalysis(today, yesterday, rat));
  sections.push(...buildBreakdowns(breakdowns));
  sections.push(...buildHistoricalTrends(history, rat));

  return sections.join('\n');
}

/* ───── suggested prompts ───── */

export const SUGGESTED_PROMPTS = [
  {
    icon: AlertTriangle,
    label: 'Why are conversions low?',
    color: 'red',
    prompt:
      'Why are my conversions low today compared to yesterday? Break it down by campaign and tell me exactly what changed.',
  },
  {
    icon: TrendingDown,
    label: 'Lead quality drop',
    color: 'orange',
    prompt:
      'Are we getting fewer or worse leads today vs yesterday? Which ad sets are underperforming and why?',
  },
  {
    icon: TrendingUp,
    label: 'Performance overview',
    color: 'blue',
    prompt:
      'Give me a comprehensive performance overview — today vs yesterday, including key metrics changes and what stands out.',
  },
  {
    icon: DollarSign,
    label: 'Cost analysis',
    color: 'green',
    prompt:
      'Analyze my cost efficiency. Where am I wasting budget? Which campaigns have the best and worst cost per result?',
  },
  {
    icon: Target,
    label: 'What to scale',
    color: 'purple',
    prompt:
      'Based on the hourly data today vs yesterday, which campaigns/ad sets should I scale up and which should I pause? Be specific.',
  },
  {
    icon: Lightbulb,
    label: 'Optimization plan',
    color: 'indigo',
    prompt:
      'Give me a prioritized list of 5 specific actions I should take right now to improve my ad performance, based on the data.',
  },
  {
    icon: BarChart3,
    label: 'Audience insights',
    color: 'teal',
    prompt:
      'Analyze my audience breakdown — which age groups, genders, devices, and platforms are performing best? Any surprises?',
  },
  {
    icon: Zap,
    label: 'Quick diagnosis',
    color: 'yellow',
    prompt:
      'Run a quick health check on my ad account. Flag anything unusual — rising costs, dropping CTR, spending without results, etc.',
  },
];

export const FOLLOW_UP_PROMPTS = [
  'What should I do about this?',
  'Break it down by ad set',
  'Which ads should I pause?',
  'Compare to last 7 days',
];

export const COLOR_HEX: Record<string, string> = {
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

/** Parse action blocks from an AI reply, returning cleaned content + structured actions. */
export function parseActionsFromReply(raw: string): { content: string; actions: ParsedAction[] } {
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
      return '';
    })
    .trim();

  return { content, actions };
}

/** Return the human-readable label for an action. */
export function actionLabel(a: ActionPayload, t: (key: string) => string): string {
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

/** Return the icon component for an action type. */
export function actionIcon(
  type: string
): typeof Pause | typeof Play | typeof DollarSign | typeof ChevronRight {
  if (type.startsWith('pause')) return Pause;
  if (type.startsWith('resume')) return Play;
  if (type === 'adjust_budget') return DollarSign;
  return ChevronRight;
}

/** Return border/bg color hex pair for an action type. */
export function actionColor(type: string): { border: string; bg: string } {
  if (type.startsWith('pause')) return { border: '#f97316', bg: '#f97316' };
  if (type.startsWith('resume')) return { border: '#22c55e', bg: '#22c55e' };
  if (type === 'adjust_budget') return { border: '#3b82f6', bg: '#3b82f6' };
  return { border: '', bg: '' };
}

/* ───── main hook ───── */

/**
 * Encapsulates all chat state, data fetching, streaming, and action execution.
 * Used by both the /chat page and the assistant overlay panel.
 */
export function useChatEngine() {
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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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

  const executeAction = useCallback(
    async (msgId: string, actionIdx: number) => {
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
    },
    [messages, fetchData]
  );

  const dismissAction = useCallback((msgId: string, actionIdx: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.actions) return m;
        const newActions = [...m.actions];
        newActions[actionIdx] = { ...newActions[actionIdx], status: 'dismissed' };
        return { ...m, actions: newActions };
      })
    );
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
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
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === loadingMsg.id
                          ? { ...m, content: fullContent, isLoading: true }
                          : m
                      )
                    );
                  }
                } catch {
                  // ignore JSON parse errors
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

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
    },
    [chatData, isLoading, messages]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input);
      }
    },
    [input, sendMessage]
  );

  /** Render markdown-like content as React elements. */
  const formatContent = useCallback((content: string) => {
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
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(html.slice(numMatch[0].length)),
            }}
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
  }, []);

  /** Render a single action card. Returns null if the action is dismissed. */
  const renderActionCard = useCallback(
    (action: ParsedAction, msgId: string, idx: number) => {
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
              <button
                onClick={() => executeAction(msgId, idx)}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-2 py-1 text-xs font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
              >
                <Check className="h-3 w-3" /> Approve
              </button>
              <button
                onClick={() => dismissAction(msgId, idx)}
                className="rounded-md p-1 hover:bg-[var(--color-muted)]"
              >
                <X className="h-3 w-3 text-[var(--color-muted-foreground)]" />
              </button>
            </div>
          )}
          {action.status === 'executing' && (
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
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
    },
    [t, executeAction, dismissAction]
  );

  const lastMsg = messages[messages.length - 1];
  const showFollowUps = lastMsg?.role === 'assistant' && !lastMsg.isLoading && !isLoading;

  return {
    // state
    messages,
    input,
    setInput,
    isLoading,
    chatData,
    dataLoading,
    dataError,
    copiedId,
    dataStats,
    showFollowUps,
    // refs
    messagesEndRef,
    inputRef,
    // handlers
    resetChat,
    copyMessage,
    sendMessage,
    handleKeyDown,
    executeAction,
    dismissAction,
    fetchData,
    // render helpers
    formatContent,
    renderActionCard,
    // constants
    t,
  };
}
