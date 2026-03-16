'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import {
  Send, Loader2, Bot, User, Sparkles, TrendingUp, TrendingDown,
  DollarSign, Target, BarChart3, Lightbulb, RefreshCw, AlertTriangle,
  Zap, Pause, Play, ChevronRight, Check, X,
} from 'lucide-react';

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
  content: string;       // text with action blocks stripped out
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
  today: { campaigns: InsightRow[]; adSets: InsightRow[]; ads: InsightRow[]; account: InsightRow[]; hourly?: InsightRow[] };
  yesterday: { campaigns: InsightRow[]; adSets: InsightRow[]; ads: InsightRow[]; account: InsightRow[]; hourly?: InsightRow[] };
  history?: {
    accountDaily: InsightRow[];   // one row per day, last 30 days
    campaignDaily: InsightRow[];  // one row per campaign per day, last 30 days
    adsetDaily: InsightRow[];     // one row per adset per day, last 7 days
  };
  breakdowns: { ageGender: InsightRow[]; device: InsightRow[]; publisher: InsightRow[] };
}

/* ───── helpers ───── */

/** Never count these as "results" — they inflate numbers */
const ENGAGEMENT_TYPES = new Set([
  'link_click', 'landing_page_view', 'page_engagement', 'post_engagement',
  'post', 'comment', 'like', 'photo_view', 'video_view', 'post_reaction',
  'onsite_conversion.post_save', 'outbound_click', 'social_click',
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
  return actions.find((a) =>
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
  const pct = ((current - previous) / previous * 100).toFixed(1);
  return (current >= previous ? '+' : '') + pct + '%';
}

/* ───── build context string ───── */
function buildRichContext(data: ChatData): string {
  const sections: string[] = [];
  const { today, yesterday, breakdowns, date, optimizationMap } = data;
  const optMap = optimizationMap || {};

  // Tell Claude what time it is so it knows today's data is partial
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  sections.push(`CURRENT TIME: ${timeStr} on ${dayStr}. Today's data is PARTIAL — the day is not over. Do not compare today's totals to yesterday's full-day totals as a "drop."\n`);

  // Helper to look up result action type for a campaign
  const rat = (campaignId?: string) => campaignId ? optMap[campaignId] : undefined;

  // Account overview comparison
  const todayAcct = today.account[0];
  const yesterdayAcct = yesterday.account[0];

  sections.push(`=== ACCOUNT OVERVIEW (${date.today}) ===`);
  if (todayAcct) {
    const tSpend = parseFloat(todayAcct.spend);
    const tClicks = parseInt(todayAcct.clicks);
    const tImpr = parseInt(todayAcct.impressions);
    const tResults = getResults(todayAcct);
    const tCpc = todayAcct.cost_per_inline_link_click || todayAcct.cpc;
    sections.push(`Today: Spend $${tSpend.toFixed(2)}, Impressions ${tImpr}, Clicks ${tClicks}, CTR ${todayAcct.ctr}%, CPC (link click) $${tCpc}, CPM $${todayAcct.cpm}, Results ${tResults}, Cost/Result $${getCostPerResult(todayAcct)}, Result Type: ${getResultType(todayAcct)}`);

    if (yesterdayAcct) {
      const ySpend = parseFloat(yesterdayAcct.spend);
      const yClicks = parseInt(yesterdayAcct.clicks);
      const yImpr = parseInt(yesterdayAcct.impressions);
      const yResults = getResults(yesterdayAcct);
      const yCpc = yesterdayAcct.cost_per_inline_link_click || yesterdayAcct.cpc;
      sections.push(`Yesterday: Spend $${ySpend.toFixed(2)}, Impressions ${yImpr}, Clicks ${yClicks}, CTR ${yesterdayAcct.ctr}%, CPC (link click) $${yCpc}, CPM $${yesterdayAcct.cpm}, Results ${yResults}, Cost/Result $${getCostPerResult(yesterdayAcct)}`);
      sections.push(`Day-over-Day Changes: Spend ${pctChange(tSpend, ySpend)}, Impressions ${pctChange(tImpr, yImpr)}, Clicks ${pctChange(tClicks, yClicks)}, Results ${pctChange(tResults, yResults)}`);
    }
  } else {
    sections.push('Today: No account data yet (campaigns may not have started delivering).');
  }

  // Campaign comparison
  sections.push('\n=== CAMPAIGNS: TODAY vs YESTERDAY ===');
  const campaignIds = new Set([
    ...today.campaigns.map((c) => c.campaign_id),
    ...yesterday.campaigns.map((c) => c.campaign_id),
  ]);
  for (const cid of campaignIds) {
    const t = today.campaigns.find((c) => c.campaign_id === cid);
    const y = yesterday.campaigns.find((c) => c.campaign_id === cid);
    const name = t?.campaign_name || y?.campaign_name || cid;

    if (t && y) {
      const r = rat(cid);
      const tSpend = parseFloat(t.spend); const ySpend = parseFloat(y.spend);
      const tResults = getResults(t, r); const yResults = getResults(y, r);
      const tClicks = parseInt(t.clicks); const yClicks = parseInt(y.clicks);
      sections.push(
        `Campaign "${name}": TODAY Spend $${tSpend.toFixed(2)}, Results ${tResults}, Clicks ${tClicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc}, CPM $${t.cpm}, Cost/Result $${getCostPerResult(t, r)} | ` +
        `YESTERDAY Spend $${ySpend.toFixed(2)}, Results ${yResults}, Clicks ${yClicks}, CTR ${y.ctr}%, CPC $${y.cost_per_inline_link_click || y.cpc}, CPM $${y.cpm}, Cost/Result $${getCostPerResult(y, r)} | ` +
        `CHANGES: Spend ${pctChange(tSpend, ySpend)}, Results ${pctChange(tResults, yResults)}, Clicks ${pctChange(tClicks, yClicks)}`
      );
    } else if (t) {
      const r = rat(cid);
      sections.push(`Campaign "${name}": TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResults(t, r)}, Clicks ${t.clicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc} | YESTERDAY: No data`);
    } else if (y) {
      const r = rat(cid);
      sections.push(`Campaign "${name}": TODAY: No data yet | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResults(y, r)}, Clicks ${y.clicks}, CTR ${y.ctr}%`);
    }
  }

  // Ad Set comparison
  sections.push('\n=== AD SETS: TODAY vs YESTERDAY ===');
  const adsetIds = new Set([
    ...today.adSets.map((a) => a.adset_id),
    ...yesterday.adSets.map((a) => a.adset_id),
  ]);
  for (const aid of adsetIds) {
    const t = today.adSets.find((a) => a.adset_id === aid);
    const y = yesterday.adSets.find((a) => a.adset_id === aid);
    const name = t?.adset_name || y?.adset_name || aid;
    const r = rat(t?.campaign_id || y?.campaign_id);

    if (t && y) {
      const tResults = getResults(t, r); const yResults = getResults(y, r);
      sections.push(
        `Ad Set "${name}": TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${tResults}, Clicks ${t.clicks}, CTR ${t.ctr}%, CPC $${t.cost_per_inline_link_click || t.cpc}, Cost/Result $${getCostPerResult(t, r)} | ` +
        `YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${yResults}, Clicks ${y.clicks}, CTR ${y.ctr}%, CPC $${y.cost_per_inline_link_click || y.cpc}, Cost/Result $${getCostPerResult(y, r)} | ` +
        `CHANGES: Results ${pctChange(tResults, yResults)}`
      );
    } else if (t) {
      sections.push(`Ad Set "${name}": TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResults(t, r)}, Clicks ${t.clicks}, CTR ${t.ctr}% | YESTERDAY: No data`);
    } else if (y) {
      sections.push(`Ad Set "${name}": TODAY: No data | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResults(y, r)}, Clicks ${y.clicks}`);
    }
  }

  // Ad-level data (today only, for granularity)
  if (today.ads.length > 0) {
    sections.push('\n=== INDIVIDUAL ADS (TODAY) ===');
    for (const ad of today.ads) {
      const r = rat(ad.campaign_id);
      sections.push(
        `Ad "${ad.ad_name}" (adset ${ad.adset_id}, campaign ${ad.campaign_id}): Spend $${parseFloat(ad.spend).toFixed(2)}, Results ${getResults(ad, r)}, Clicks ${ad.clicks}, CTR ${ad.ctr}%, CPC $${ad.cost_per_inline_link_click || ad.cpc}, Cost/Result $${getCostPerResult(ad, r)}`
      );
    }
  }

  // Hourly breakdown helper
  const formatHour = (h: string) => {
    const hourNum = parseInt(h?.split(':')[0] || '0');
    if (hourNum === 0) return '12am';
    if (hourNum < 12) return `${hourNum}am`;
    if (hourNum === 12) return '12pm';
    return `${hourNum - 12}pm`;
  };

  const getHourKey = (row: InsightRow) => row.hourly_stats_aggregated_by_advertiser_time_zone || '00:00:00';

  // Build hourly data indexed by campaign → hour for both days
  const todayHourly = today.hourly || [];
  const yesterdayHourly = yesterday.hourly || [];

  if (todayHourly.length > 0 || yesterdayHourly.length > 0) {
    sections.push('\n=== HOUR-BY-HOUR COMPARISON: TODAY vs YESTERDAY (by campaign) ===');
    sections.push('Format: Hour | TODAY: Spend/Results/Clicks/Impr/CTR/CPC | YESTERDAY: Spend/Results/Clicks/Impr/CTR/CPC | CHANGE');

    // Group by campaign ID (using ID for matching across days, name for display)
    const allCampaignIds = new Set([
      ...todayHourly.map((r) => r.campaign_id || 'unknown'),
      ...yesterdayHourly.map((r) => r.campaign_id || 'unknown'),
    ]);

    for (const cid of allCampaignIds) {
      const r = rat(cid);
      const todayRows = todayHourly.filter((row) => (row.campaign_id || 'unknown') === cid);
      const yesterdayRows = yesterdayHourly.filter((row) => (row.campaign_id || 'unknown') === cid);
      const campaignName = todayRows[0]?.campaign_name || yesterdayRows[0]?.campaign_name || cid;

      // Index by hour
      const todayByHour: Record<string, InsightRow> = {};
      for (const row of todayRows) todayByHour[getHourKey(row)] = row;
      const yesterdayByHour: Record<string, InsightRow> = {};
      for (const row of yesterdayRows) yesterdayByHour[getHourKey(row)] = row;

      // Get all hours present in either day, sorted
      const allHours = [...new Set([
        ...Object.keys(todayByHour),
        ...Object.keys(yesterdayByHour),
      ])].sort();

      sections.push(`\nCampaign "${campaignName}":`);

      // Accumulate running totals for summary
      let tTotalSpend = 0, tTotalResults = 0, tTotalClicks = 0, tTotalImpr = 0;
      let yTotalSpend = 0, yTotalResults = 0, yTotalClicks = 0, yTotalImpr = 0;

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

        tTotalSpend += tSpend; tTotalResults += tResults; tTotalClicks += tClicks; tTotalImpr += tImpr;
        yTotalSpend += ySpend; yTotalResults += yResults; yTotalClicks += yClicks; yTotalImpr += yImpr;

        // Only show hours that have data on at least one day
        if (t && y) {
          const spendDelta = ySpend > 0 ? pctChange(tSpend, ySpend) : (tSpend > 0 ? 'new' : '');
          const resultsDelta = yResults > 0 ? pctChange(tResults, yResults) : (tResults > 0 ? 'new' : '');
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

      // Campaign hourly summary
      const spendChg = yTotalSpend > 0 ? pctChange(tTotalSpend, yTotalSpend) : 'N/A';
      const resultsChg = yTotalResults > 0 ? pctChange(tTotalResults, yTotalResults) : 'N/A';
      sections.push(
        `  HOURLY TOTALS: TODAY $${tTotalSpend.toFixed(2)} spend / ${tTotalResults} results / ${tTotalClicks} clicks | ` +
        `YESTERDAY $${yTotalSpend.toFixed(2)} spend / ${yTotalResults} results / ${yTotalClicks} clicks | ` +
        `Δ spend ${spendChg}, results ${resultsChg}`
      );
    }
  }

  // Breakdowns
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

  // ──── HISTORICAL DAILY DATA (last 30 days) ────
  const history = data.history;
  if (history) {
    // Account-level daily totals (last 30 days)
    if (history.accountDaily.length > 0) {
      sections.push('\n=== DAILY ACCOUNT PERFORMANCE (LAST 30 DAYS) ===');
      sections.push('Date | Spend | Impressions | Clicks | CTR | CPC | CPM | Results | Cost/Result');
      // Sort by date ascending
      const sorted = [...history.accountDaily].sort((a, b) => a.date_start.localeCompare(b.date_start));
      for (const row of sorted) {
        const results = getResults(row);
        const cpr = getCostPerResult(row);
        const cpc = row.cost_per_inline_link_click || row.cpc;
        sections.push(
          `${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Impr ${row.impressions}, Clicks ${row.clicks}, CTR ${row.ctr}%, CPC $${cpc}, CPM $${row.cpm}, Results ${results}, Cost/Result $${cpr}`
        );
      }

      // Compute 7-day and 14-day averages for easy comparison
      const last7 = sorted.slice(-7);
      const last14 = sorted.slice(-14);
      const avg = (rows: InsightRow[], field: 'spend' | 'clicks' | 'impressions') =>
        rows.reduce((sum, r) => sum + parseFloat(r[field] || '0'), 0) / (rows.length || 1);
      const avgResults = (rows: InsightRow[]) =>
        rows.reduce((sum, r) => sum + getResults(r), 0) / (rows.length || 1);

      if (last7.length >= 7) {
        sections.push(`\n7-Day Averages: Spend $${avg(last7, 'spend').toFixed(2)}/day, Clicks ${avg(last7, 'clicks').toFixed(0)}/day, Impr ${avg(last7, 'impressions').toFixed(0)}/day, Results ${avgResults(last7).toFixed(1)}/day`);
      }
      if (last14.length >= 14) {
        sections.push(`14-Day Averages: Spend $${avg(last14, 'spend').toFixed(2)}/day, Clicks ${avg(last14, 'clicks').toFixed(0)}/day, Impr ${avg(last14, 'impressions').toFixed(0)}/day, Results ${avgResults(last14).toFixed(1)}/day`);
      }
      const all30 = sorted;
      if (all30.length >= 20) {
        sections.push(`30-Day Averages: Spend $${avg(all30, 'spend').toFixed(2)}/day, Clicks ${avg(all30, 'clicks').toFixed(0)}/day, Impr ${avg(all30, 'impressions').toFixed(0)}/day, Results ${avgResults(all30).toFixed(1)}/day`);
      }
    }

    // Campaign-level daily data (last 30 days) — grouped by campaign
    if (history.campaignDaily.length > 0) {
      sections.push('\n=== DAILY CAMPAIGN PERFORMANCE (LAST 30 DAYS) ===');
      // Group by campaign
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
  }

  return sections.join('\n');
}

/* ───── suggested prompts ───── */
const SUGGESTED_PROMPTS = [
  { icon: AlertTriangle, label: 'Why are conversions low?', color: 'red', prompt: 'Why are my conversions low today compared to yesterday? Break it down by campaign and tell me exactly what changed.' },
  { icon: TrendingDown, label: 'Lead quality drop', color: 'orange', prompt: 'Are we getting fewer or worse leads today vs yesterday? Which ad sets are underperforming and why?' },
  { icon: TrendingUp, label: 'Performance overview', color: 'blue', prompt: 'Give me a comprehensive performance overview — today vs yesterday, including key metrics changes and what stands out.' },
  { icon: DollarSign, label: 'Cost analysis', color: 'green', prompt: 'Analyze my cost efficiency. Where am I wasting budget? Which campaigns have the best and worst cost per result?' },
  { icon: Target, label: 'What to scale', color: 'purple', prompt: 'Based on the hourly data today vs yesterday, which campaigns/ad sets should I scale up and which should I pause? Be specific.' },
  { icon: Lightbulb, label: 'Optimization plan', color: 'indigo', prompt: 'Give me a prioritized list of 5 specific actions I should take right now to improve my ad performance, based on the data.' },
  { icon: BarChart3, label: 'Audience insights', color: 'teal', prompt: 'Analyze my audience breakdown — which age groups, genders, devices, and platforms are performing best? Any surprises?' },
  { icon: Zap, label: 'Quick diagnosis', color: 'yellow', prompt: 'Run a quick health check on my ad account. Flag anything unusual — rising costs, dropping CTR, spending without results, etc.' },
];

const COLOR_MAP: Record<string, string> = {
  red: 'bg-red-50 group-hover:bg-red-100 text-red-600',
  orange: 'bg-orange-50 group-hover:bg-orange-100 text-orange-600',
  blue: 'bg-blue-50 group-hover:bg-blue-100 text-blue-600',
  green: 'bg-green-50 group-hover:bg-green-100 text-green-600',
  purple: 'bg-purple-50 group-hover:bg-purple-100 text-purple-600',
  indigo: 'bg-indigo-50 group-hover:bg-indigo-100 text-indigo-600',
  teal: 'bg-teal-50 group-hover:bg-teal-100 text-teal-600',
  yellow: 'bg-yellow-50 group-hover:bg-yellow-100 text-yellow-600',
};

/* ───── action helpers ───── */
const ACTION_RE = /:::action(\{.*?\}):::/g;

function parseActionsFromReply(raw: string): { content: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = [];
  const content = raw.replace(ACTION_RE, (_, json) => {
    try {
      const payload = JSON.parse(json) as ActionPayload;
      if (payload.type && payload.id) {
        actions.push({ payload, status: 'pending' });
      }
    } catch { /* ignore malformed */ }
    return ''; // strip from visible text
  }).trim();
  return { content, actions };
}

function actionLabel(a: ActionPayload): string {
  const labels: Record<string, string> = {
    pause_campaign: 'Pause Campaign',
    resume_campaign: 'Resume Campaign',
    pause_ad_set: 'Pause Ad Set',
    resume_ad_set: 'Resume Ad Set',
    pause_ad: 'Pause Ad',
    resume_ad: 'Resume Ad',
    adjust_budget: 'Adjust Budget',
  };
  return labels[a.type] || a.type;
}

function actionIcon(type: string) {
  if (type.startsWith('pause')) return Pause;
  if (type.startsWith('resume')) return Play;
  if (type === 'adjust_budget') return DollarSign;
  return ChevronRight;
}

function actionColor(type: string): string {
  if (type.startsWith('pause')) return 'border-orange-200 bg-orange-50';
  if (type.startsWith('resume')) return 'border-green-200 bg-green-50';
  if (type === 'adjust_budget') return 'border-blue-200 bg-blue-50';
  return 'border-gray-200 bg-gray-50';
}

/* ───── main component ───── */
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => { scrollToBottom(); }, [messages]);

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
      console.error('Failed to load chat data:', err);
      setDataError('Could not load account data. Make sure you are logged in.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* Data stats for UI */
  const dataStats = chatData ? {
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
  } : null;

  /* Execute an approved action */
  const executeAction = async (msgId: string, actionIdx: number) => {
    // Mark as executing
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId || !m.actions) return m;
      const newActions = [...m.actions];
      newActions[actionIdx] = { ...newActions[actionIdx], status: 'executing' };
      return { ...m, actions: newActions };
    }));

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

      setMessages((prev) => prev.map((m) => {
        if (m.id !== msgId || !m.actions) return m;
        const newActions = [...m.actions];
        newActions[actionIdx] = {
          ...newActions[actionIdx],
          status: data.success ? 'done' : 'error',
          result: data.result || data.error || 'Unknown error',
        };
        return { ...m, actions: newActions };
      }));

      // Refresh data after successful action
      if (data.success) fetchData();
    } catch {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== msgId || !m.actions) return m;
        const newActions = [...m.actions];
        newActions[actionIdx] = { ...newActions[actionIdx], status: 'error', result: 'Network error' };
        return { ...m, actions: newActions };
      }));
    }
  };

  const dismissAction = (msgId: string, actionIdx: number) => {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId || !m.actions) return m;
      const newActions = [...m.actions];
      newActions[actionIdx] = { ...newActions[actionIdx], status: 'dismissed' };
      return { ...m, actions: newActions };
    }));
  };

  /* Send message */
  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`, role: 'user', content: text.trim(), timestamp: new Date(),
    };
    const loadingMsg: Message = {
      id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date(), isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const context = chatData ? buildRichContext(chatData) : 'No account data available — user may not be logged in or data hasn\'t loaded yet.';
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
                      m.id === loadingMsg.id
                        ? { ...m, content: fullContent, isLoading: true }
                        : m
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
            ? { ...m, content, actions: actions.length > 0 ? actions : undefined, isLoading: false }
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  /* Format message content with markdown-like rendering */
  const formatContent = (content: string) => {
    return content.split('\n').map((line, i) => {
      // Headers
      if (line.startsWith('#### ')) return <h5 key={i} className="font-semibold text-xs uppercase tracking-wider text-gray-500 mt-4 mb-1">{line.slice(5)}</h5>;
      if (line.startsWith('### ')) return <h4 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h4>;
      if (line.startsWith('## ')) return <h3 key={i} className="font-bold text-base mt-4 mb-1">{line.slice(3)}</h3>;
      if (line.startsWith('# ')) return <h2 key={i} className="font-bold text-lg mt-4 mb-2">{line.slice(2)}</h2>;
      // Horizontal rule
      if (line.trim() === '---' || line.trim() === '***') return <hr key={i} className="my-3 border-gray-200" />;
      // Bold + italic
      let html = line
        .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
      // Inline code
      html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">$1</code>');
      // Metric highlights: detect patterns like "$24.72" or "↓22%" or "+15.3%"
      html = html.replace(/(\$[\d,.]+)/g, '<span class="font-semibold text-gray-900">$1</span>');
      html = html.replace(/(↑[\d.]+%|↑\d+)/g, '<span class="font-semibold text-green-600">$1</span>');
      html = html.replace(/(↓[\d.]+%|↓\d+)/g, '<span class="font-semibold text-red-600">$1</span>');
      // Bullets
      if (line.startsWith('- ') || line.startsWith('• '))
        return <li key={i} className="ml-4 list-disc text-sm" dangerouslySetInnerHTML={{ __html: html.slice(2) }} />;
      // Numbered
      const numMatch = line.match(/^(\d+)\.\s/);
      if (numMatch)
        return <li key={i} className="ml-4 list-decimal text-sm" dangerouslySetInnerHTML={{ __html: html.slice(numMatch[0].length) }} />;
      // Empty
      if (!line.trim()) return <br key={i} />;
      // Confidence badge
      html = html
        .replace(/Confidence:\s*High/gi, '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Confidence: High</span>')
        .replace(/Confidence:\s*Medium/gi, '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Confidence: Medium</span>')
        .replace(/Confidence:\s*Low/gi, '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Confidence: Low</span>');
      return <p key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  /* Render action card */
  const renderActionCard = (action: ParsedAction, msgId: string, idx: number) => {
    const Icon = actionIcon(action.payload.type);
    const colors = actionColor(action.payload.type);
    const label = actionLabel(action.payload);
    const name = action.payload.name || action.payload.id;
    const budgetStr = action.payload.budget ? ` → $${action.payload.budget.toFixed(2)}/day` : '';

    if (action.status === 'dismissed') return null;

    return (
      <div key={idx} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${colors} transition-all`}>
        <Icon className="h-4 w-4 flex-shrink-0 text-gray-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{label}: {name}{budgetStr}</p>
          {action.result && (
            <p className={`text-xs mt-0.5 ${action.status === 'error' ? 'text-red-600' : 'text-green-600'}`}>
              {action.result}
            </p>
          )}
        </div>
        {action.status === 'pending' && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => executeAction(msgId, idx)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <Check className="h-3 w-3" /> Approve
            </button>
            <button
              onClick={() => dismissAction(msgId, idx)}
              className="inline-flex items-center px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {action.status === 'executing' && (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500 flex-shrink-0" />
        )}
        {action.status === 'done' && (
          <div className="flex-shrink-0 h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-green-600" />
          </div>
        )}
        {action.status === 'error' && (
          <div className="flex-shrink-0 h-6 w-6 rounded-full bg-red-100 flex items-center justify-center">
            <X className="h-3.5 w-3.5 text-red-600" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Custom header without date picker — AI Chat always loads all available data */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Chat</h1>
          <p className="mt-1 text-sm text-gray-500">Deep performance analysis powered by Claude — includes last 30 days of data</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          /* Empty state */
          <div className="max-w-3xl mx-auto px-8 py-12">
            <div className="text-center mb-10">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-4">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Ask anything about your ads</h2>
              <p className="text-gray-500 max-w-lg mx-auto">
                Powered by Claude with access to your live Meta Ads data — including today vs yesterday comparisons, hourly data, and audience breakdowns.
              </p>

              {/* Data loading status */}
              {dataLoading && (
                <div className="flex items-center justify-center gap-2 mt-4 text-sm text-blue-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your account data (today, yesterday, hourly breakdowns)...
                </div>
              )}
              {dataError && (
                <div className="flex items-center justify-center gap-2 mt-4 text-sm text-red-600">
                  <AlertTriangle className="h-4 w-4" /> {dataError}
                </div>
              )}
              {!dataLoading && dataStats && (
                <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-400">
                  <span>{dataStats.campaigns} campaigns</span>
                  <span>·</span>
                  <span>{dataStats.adSets} ad sets</span>
                  <span>·</span>
                  <span>{dataStats.ads} ads</span>
                  {dataStats.hasYesterday && <><span>·</span><span className="text-green-500">✓ yesterday comparison</span></>}
                  {dataStats.hasHourly && <><span>·</span><span className="text-green-500">✓ hourly data</span></>}
                  {dataStats.hasBreakdowns && <><span>·</span><span className="text-green-500">✓ audience breakdowns</span></>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SUGGESTED_PROMPTS.map((prompt, idx) => {
                const Icon = prompt.icon;
                const colorClasses = COLOR_MAP[prompt.color] || COLOR_MAP.blue;
                return (
                  <button
                    key={idx}
                    onClick={() => sendMessage(prompt.prompt)}
                    disabled={isLoading || dataLoading}
                    className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all text-left group disabled:opacity-50"
                  >
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors flex-shrink-0 ${colorClasses}`}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{prompt.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{prompt.prompt}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="max-w-3xl mx-auto px-8 py-6 space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0 mt-1">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-2xl rounded-tr-md px-4 py-3'
                    : 'bg-white border border-gray-200 rounded-2xl rounded-tl-md px-5 py-4'
                }`}>
                  {msg.isLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      <span className="text-sm text-gray-500">Diagnosing performance hour-by-hour…</span>
                    </div>
                  ) : (
                    <>
                      <div className={`text-sm leading-relaxed space-y-1 ${msg.role === 'user' ? 'text-white' : 'text-gray-800'}`}>
                        {formatContent(msg.content)}
                      </div>
                      {/* Action approval cards */}
                      {msg.actions && msg.actions.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                            <Zap className="h-3 w-3" /> Suggested Actions
                          </p>
                          {msg.actions.map((action, idx) => renderActionCard(action, msg.id, idx))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 flex-shrink-0 mt-1">
                    <User className="h-4 w-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-8 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3">
            <Button variant="outline" size="icon" onClick={fetchData} disabled={dataLoading} title="Refresh data">
              <RefreshCw className={`h-4 w-4 ${dataLoading ? 'animate-spin' : ''}`} />
            </Button>
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask: Why are conversions low today? / What should I scale? / Give me a health check..."
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none min-h-[44px] max-h-[120px]"
                rows={1}
                disabled={isLoading}
              />
              <Button
                size="icon"
                className="absolute right-2 bottom-1.5 h-8 w-8 rounded-lg"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Powered by Claude · Comparing today vs yesterday + hourly data + audience breakdowns
          </p>
        </div>
      </div>
    </div>
  );
}
