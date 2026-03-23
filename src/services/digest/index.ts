/**
 * DigestService — builds and posts periodic ad performance summaries to Slack.
 *
 * Supports daily, weekly, and monthly digest types. Each type maps to a
 * Meta date preset so the data window matches the digest label exactly.
 *
 * @example
 * ```ts
 * const digest = new DigestService(slack);
 * await digest.send({
 *   type: 'weekly',
 *   channelIds: ['C12345'],
 *   accountIds: ['123456'],
 *   metaSystemToken: process.env.META_SYSTEM_ACCESS_TOKEN!,
 * });
 * ```
 */

import { MetaService } from '@/services/meta';
import { SlackService } from '@/services/slack';
import { getResultCount } from '@/lib/automation-utils';
import { createLogger } from '@/services/logger';
import { formatCurrency } from '@/lib/utils';
import type { MetaInsightsRow } from '@/types';
import type { DigestChannelResult, DigestConfig, DigestResult, DigestType } from './types';

export type { DigestType, DigestConfig, DigestResult, DigestChannelResult } from './types';

const logger = createLogger('Digest');

/** Maps each digest type to the Meta date preset covering the same window. */
const DATE_PRESET: Record<DigestType, string> = {
  daily: 'yesterday',
  weekly: 'last_7d',
  monthly: 'last_30d',
};

/** Maps each digest type to the period label shown in the Slack message. */
const PERIOD_LABEL: Record<DigestType, string> = {
  daily: 'Yesterday',
  weekly: 'Last 7 days',
  monthly: 'Last 30 days',
};

/** Fetched data for a single account, scoped to the digest's date window. */
interface AccountDigestData {
  accountName: string;
  campaignRows: MetaInsightsRow[];
  accountRows: MetaInsightsRow[];
  optimizationMap: Record<string, string>;
}

export class DigestService {
  constructor(private readonly slack: SlackService) {}

  /**
   * Builds the Slack block body lines from per-account digest data.
   *
   * @param datasets - Per-account data fetched for the digest window
   * @param periodLabel - Human-readable period string for the summary header
   */
  formatDigestBody(datasets: AccountDigestData[], periodLabel: string): string[] {
    const lines: string[] = [];
    let totalSpend = 0;
    let totalResults = 0;

    const allCampaigns: Array<{
      name: string;
      spend: number;
      results: number;
      cpa: number;
      accountName: string;
    }> = [];

    for (const data of datasets) {
      const accountLabel = datasets.length > 1 ? ` (${data.accountName})` : '';

      // Aggregate daily rows into per-campaign totals
      const campaignTotals: Record<string, { name: string; spend: number; results: number }> = {};

      for (const row of data.campaignRows) {
        const id = row.campaign_id ?? row.campaign_name ?? 'unknown';
        const name = row.campaign_name ?? id;
        const spend = parseFloat(row.spend) || 0;
        // Always pass campaign_id for the optimizationMap lookup — falling back to
        // the name would miss the map (keyed by campaign_id) and silently return 0.
        const results = getResultCount(row, row.campaign_id, data.optimizationMap);

        if (!campaignTotals[id]) campaignTotals[id] = { name, spend: 0, results: 0 };
        campaignTotals[id].spend += spend;
        campaignTotals[id].results += results;
      }

      let accountSpend = 0;
      let accountResults = 0;

      for (const c of Object.values(campaignTotals)) {
        accountSpend += c.spend;
        accountResults += c.results;
        const cpa = c.results > 0 ? c.spend / c.results : Infinity;

        allCampaigns.push({
          name: c.name,
          spend: c.spend,
          results: c.results,
          cpa,
          accountName: data.accountName,
        });
      }

      // Fall back to account-level rows if campaign data is empty
      if (accountSpend === 0) {
        for (const row of data.accountRows) {
          accountSpend += parseFloat(row.spend) || 0;
        }
      }

      totalSpend += accountSpend;
      totalResults += accountResults;

      if (datasets.length > 1) {
        const accountCpa =
          accountResults > 0
            ? `${formatCurrency(accountSpend / accountResults)} CPA`
            : 'No results';

        lines.push(
          `*${data.accountName}${accountLabel}*\n` +
            `Spend: ${formatCurrency(accountSpend)} · Results: ${accountResults} · ${accountCpa}`
        );
      }
    }

    // Summary line prepended to the top
    const totalCpa =
      totalResults > 0 ? `${formatCurrency(totalSpend / totalResults)} CPA` : 'No results';

    lines.unshift(
      `*${periodLabel} performance*\n` +
        `💰 Spend: *${formatCurrency(totalSpend)}* · 🎯 Results: *${totalResults}* · 📊 ${totalCpa}`
    );

    // Top and worst campaign by CPA (must have at least 1 result)
    const ranked = allCampaigns
      .filter((c) => c.results > 0 && isFinite(c.cpa))
      .sort((a, b) => a.cpa - b.cpa);

    if (ranked.length > 0) {
      const top = ranked[0];
      const topLabel = datasets.length > 1 ? ` (${top.accountName})` : '';

      lines.push(
        `*🏆 Best campaign${topLabel}:* ${top.name}\n` +
          `${formatCurrency(top.spend)} spend · ${top.results} results · ${formatCurrency(top.cpa)} CPA`
      );

      if (ranked.length > 1) {
        const worst = ranked[ranked.length - 1];
        const worstLabel = datasets.length > 1 ? ` (${worst.accountName})` : '';

        lines.push(
          `*⚠️ Highest CPA campaign${worstLabel}:* ${worst.name}\n` +
            `${formatCurrency(worst.spend)} spend · ${worst.results} results · ${formatCurrency(worst.cpa)} CPA`
        );
      }
    }

    return lines;
  }

  /**
   * Fetches ad data for the digest window, formats the summary, and posts it
   * to each configured Slack channel.
   *
   * @param config - Digest configuration
   * @returns Aggregate result with per-channel outcomes
   */
  async send(config: DigestConfig): Promise<DigestResult> {
    const { type, channelIds, accountIds, metaSystemToken } = config;
    const datePreset = DATE_PRESET[type];
    const period = PERIOD_LABEL[type];

    logger.info('Sending digest', {
      type,
      datePreset,
      channels: channelIds.length,
      accounts: accountIds.length,
    });

    const datasets: AccountDigestData[] = await Promise.all(
      accountIds.map(async (accountId) => {
        const meta = new MetaService(metaSystemToken, accountId);

        const [campaignResult, accountResult, optimizationMap, adAccountInfo] =
          await Promise.allSettled([
            meta.getDailyInsights(datePreset, 'campaign'),
            meta.getDailyInsights(datePreset, 'account'),
            meta.getCampaignOptimizationMap(),
            meta.getAdAccount(),
          ]);

        const campaignRows =
          campaignResult.status === 'fulfilled' ? (campaignResult.value.data ?? []) : [];
        const accountRows =
          accountResult.status === 'fulfilled' ? (accountResult.value.data ?? []) : [];
        const optMap = optimizationMap.status === 'fulfilled' ? optimizationMap.value : {};
        const accountName =
          adAccountInfo.status === 'fulfilled'
            ? ((adAccountInfo.value as { name?: string }).name ?? `Account ${accountId}`)
            : `Account ${accountId}`;

        return { accountName, campaignRows, accountRows, optimizationMap: optMap };
      })
    );

    const body = this.formatDigestBody(datasets, period);
    const header = `📊 *Wonderly Ad Digest — ${period}*`;
    const footer = `Generated ${new Date().toUTCString()}`;
    const blocks = SlackService.buildNotificationBlocks(header, body, footer);

    const channels: DigestChannelResult[] = await Promise.all(
      channelIds.map(async (channelId) => {
        try {
          const message = await this.slack.postMessage(channelId, header, blocks);

          logger.info('Digest posted', { type, channelId, ts: message?.ts });

          return { channelId, messageTs: message?.ts };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);

          logger.error('Failed to post digest to channel', { channelId, error });

          return { channelId, error: msg };
        }
      })
    );

    return { type, channels };
  }
}
