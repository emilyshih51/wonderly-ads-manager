'use client';

import { useState, useMemo } from 'react';
import NextImage from 'next/image';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/app-store';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils';
import { formatTrend } from '@/lib/theme';
import { useCampaigns, type CampaignRow } from '@/lib/queries/meta/use-campaigns';
import {
  useDashboardInsights,
  useDrillDown,
  useBudgetMutation,
  useCampaignsPriorPeriod,
} from '@/lib/queries/meta/use-dashboard';
import type { AdSetRow } from '@/lib/queries/meta/use-adsets';
import { DashboardSkeleton } from '@/components/skeletons/dashboard-skeleton';
import { MetricCard } from '@/components/dashboard/metric-card';
import { StatDetailPanel } from '@/components/dashboard/stat-detail-panel';
import { AreaChart, BarChart } from '@/components/data/chart';
import {
  DollarSign,
  Eye,
  MousePointer,
  Target,
  TrendingUp,
  BarChart3,
  ArrowLeft,
  RefreshCw,
  Image as ImageIcon,
} from 'lucide-react';
import { createLogger } from '@/services/logger';
import { useTranslations } from 'next-intl';

const logger = createLogger('Dashboard');

/* ---------- Helpers ---------- */

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

function getResults(
  actions?: Array<{ action_type: string; value: string }>,
  resultActionType?: string | null
) {
  if (!actions) return 0;

  if (resultActionType) {
    const found = actions.find((a) => a.action_type === resultActionType);

    return found ? parseInt(found.value) : 0;
  }

  const conversion = actions.find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.')) &&
      !ENGAGEMENT_TYPES.has(a.action_type)
  );

  return conversion ? parseInt(conversion.value) : 0;
}

function getCostPerResult(
  costPerAction?: Array<{ action_type: string; value: string }>,
  resultActionType?: string | null,
  spend?: string | null,
  actions?: Array<{ action_type: string; value: string }> | null
): number | null {
  if (costPerAction) {
    if (resultActionType) {
      const found = costPerAction.find((a) => a.action_type === resultActionType);

      if (found) return parseFloat(found.value);
    } else {
      const conversion = costPerAction.find(
        (a) =>
          (a.action_type.startsWith('offsite_conversion.') ||
            a.action_type.startsWith('onsite_conversion.')) &&
          !ENGAGEMENT_TYPES.has(a.action_type)
      );

      if (conversion) return parseFloat(conversion.value);
    }
  }

  if (spend && actions) {
    const results = getResults(actions, resultActionType);

    if (results > 0) return parseFloat(spend) / results;
  }

  return null;
}

function sumCampaigns(campaigns: CampaignRow[]) {
  return campaigns.reduce(
    (acc, c) => {
      if (!c.insights) return acc;
      acc.spend += parseFloat(c.insights.spend || '0');
      acc.impressions += parseInt(c.insights.impressions || '0');
      acc.clicks += parseInt(c.insights.clicks || '0');
      acc.linkClicks += parseInt(c.insights.inline_link_clicks || '0');
      acc.results += getResults(c.insights.actions, c.result_action_type);
      const cpr = getCostPerResult(
        c.insights.cost_per_action_type,
        c.result_action_type,
        c.insights.spend,
        c.insights.actions
      );
      const res = getResults(c.insights.actions, c.result_action_type);

      if (cpr !== null && res > 0) {
        acc.costPerResultSum += cpr * res;
        acc.costPerResultCount += res;
      }

      return acc;
    },
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      linkClicks: 0,
      results: 0,
      costPerResultSum: 0,
      costPerResultCount: 0,
    }
  );
}

/* ---------- Component ---------- */

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tMetrics = useTranslations('metrics');
  const tCommon = useTranslations('common');
  const { datePreset } = useAppStore();
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  const {
    data: campaigns = [],
    isLoading: campaignsLoading,
    isFetching: campaignsFetching,
  } = useCampaigns(datePreset);
  const { data: timeSeries = [], isLoading: insightsLoading } = useDashboardInsights(datePreset);
  const { data: priorCampaigns = [], isLoading: priorLoading } =
    useCampaignsPriorPeriod(datePreset);
  const {
    adSets: drillAdSets,
    ads: drillAds,
    isLoading: drillLoading,
  } = useDrillDown(selectedCampaign, datePreset);
  const budgetMutation = useBudgetMutation();

  const loading = campaignsLoading || insightsLoading;

  const [editingBudget, setEditingBudget] = useState<{
    id: string;
    type: 'adset' | 'campaign';
    value: string;
  } | null>(null);

  const handleBudgetSave = async () => {
    if (!editingBudget) return;

    try {
      const entity =
        editingBudget.type === 'adset'
          ? drillAdSets.find((a) => a.id === editingBudget.id)
          : campaigns.find((c) => c.id === editingBudget.id);
      const entityName = entity
        ? 'name' in entity
          ? entity.name
          : editingBudget.id
        : editingBudget.id;
      const previousBudget =
        editingBudget.type === 'adset'
          ? (entity as AdSetRow)?.daily_budget
            ? String(parseInt((entity as AdSetRow).daily_budget!) / 100)
            : undefined
          : undefined;

      await budgetMutation.mutateAsync({
        adset_id: editingBudget.id,
        adset_name: entityName,
        daily_budget: editingBudget.value,
        previous_budget: previousBudget,
      });
      setEditingBudget(null);
    } catch (e) {
      logger.error('Budget save failed', e);
    }
  };

  const activeCampaigns = useMemo(
    () =>
      selectedCampaign === 'all' ? campaigns : campaigns.filter((c) => c.id === selectedCampaign),
    [campaigns, selectedCampaign]
  );

  const selectedResultActionType =
    selectedCampaign !== 'all'
      ? (campaigns.find((c) => c.id === selectedCampaign)?.result_action_type ?? null)
      : null;

  const { metricCards } = useMemo(() => {
    const t = sumCampaigns(activeCampaigns);
    const prior = sumCampaigns(priorCampaigns);

    const cpr = t.costPerResultCount > 0 ? t.costPerResultSum / t.costPerResultCount : null;
    const priorCpr =
      prior.costPerResultCount > 0 ? prior.costPerResultSum / prior.costPerResultCount : null;

    let cpm: string, ctr: string, cpc: string;
    let cpmNum: number, ctrNum: number, cpcNum: number;

    if (selectedCampaign !== 'all' && activeCampaigns.length === 1 && activeCampaigns[0].insights) {
      const i = activeCampaigns[0].insights;

      cpmNum = parseFloat(i.cpm || '0');
      ctrNum = parseFloat(i.ctr || '0');
      cpcNum = i.cost_per_inline_link_click ? parseFloat(i.cost_per_inline_link_click) : 0;
      cpm = formatCurrency(cpmNum);
      ctr = formatPercent(ctrNum);
      cpc = i.cost_per_inline_link_click ? formatCurrency(cpcNum) : '-';
    } else {
      cpmNum = t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0;
      ctrNum = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
      cpcNum = t.linkClicks > 0 ? t.spend / t.linkClicks : 0;
      cpm = t.impressions > 0 ? formatCurrency(cpmNum) : '-';
      ctr = t.impressions > 0 ? formatPercent(ctrNum) : '-';
      cpc = t.linkClicks > 0 ? formatCurrency(cpcNum) : '-';
    }

    const priorCpmNum = prior.impressions > 0 ? (prior.spend / prior.impressions) * 1000 : 0;
    const priorCtrNum = prior.impressions > 0 ? (prior.clicks / prior.impressions) * 100 : 0;
    const priorCpcNum = prior.linkClicks > 0 ? prior.spend / prior.linkClicks : 0;

    const cards = [
      {
        label: tMetrics('amountSpent'),
        value: formatCurrency(t.spend),
        icon: DollarSign,
        color: 'text-emerald-600',
        bg: 'bg-emerald-100',
        metricKey: 'spend' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(t.spend, prior.spend) : null,
        isPositiveTrend: false, // higher spend = bad
      },
      {
        label: tMetrics('cpm'),
        value: cpm,
        icon: Eye,
        color: 'text-blue-600',
        bg: 'bg-blue-100',
        metricKey: 'cpm' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(cpmNum, priorCpmNum) : null,
        isPositiveTrend: false,
      },
      {
        label: tMetrics('ctr'),
        value: ctr,
        icon: MousePointer,
        color: 'text-purple-600',
        bg: 'bg-purple-100',
        metricKey: 'ctr' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(ctrNum, priorCtrNum) : null,
        isPositiveTrend: true,
      },
      {
        label: tMetrics('cpc'),
        value: cpc,
        icon: TrendingUp,
        color: 'text-amber-600',
        bg: 'bg-amber-100',
        metricKey: 'cpc' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(cpcNum, priorCpcNum) : null,
        isPositiveTrend: false,
      },
      {
        label: tMetrics('results'),
        value: formatNumber(t.results),
        icon: Target,
        color: 'text-rose-600',
        bg: 'bg-rose-100',
        metricKey: 'results' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(t.results, prior.results) : null,
        isPositiveTrend: true,
      },
      {
        label: tMetrics('costPerResult'),
        value: cpr !== null ? formatCurrency(cpr) : '-',
        icon: BarChart3,
        color: 'text-indigo-600',
        bg: 'bg-indigo-100',
        metricKey: 'cpr' as const,
        trend:
          priorCampaigns.length > 0 && cpr !== null && priorCpr !== null
            ? formatTrend(cpr, priorCpr)
            : null,
        isPositiveTrend: false,
      },
    ];

    return { metricCards: cards };
    // tMetrics and tCommon are stable refs from next-intl — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaigns, priorCampaigns, selectedCampaign, timeSeries]);

  const spendChartData = useMemo(
    () =>
      timeSeries.map((row) => ({
        date: row.date_start?.split('T')[0]?.slice(5) || '',
        spend: parseFloat(row.spend || '0'),
      })),
    [timeSeries]
  );

  const resultsChartData = useMemo(
    () =>
      timeSeries.map((row) => ({
        date: row.date_start?.split('T')[0]?.slice(5) || '',
        results: getResults(row.actions, selectedResultActionType),
      })),
    [timeSeries, selectedResultActionType]
  );

  const campaignOptions = [
    { label: tCommon('allCampaigns'), value: 'all' },
    ...campaigns.map((c) => ({ label: c.name, value: c.id })),
  ];

  if (loading && campaigns.length === 0) {
    return <DashboardSkeleton />;
  }

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
        <div className="flex items-center gap-3">
          {campaignsFetching && (
            <RefreshCw className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
          )}
          <SelectNative
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
            options={campaignOptions}
            className="w-72"
          />
        </div>
      </Header>

      <div className="space-y-8 p-8">
        {selectedCampaign !== 'all' && (
          <Button variant="ghost" size="sm" onClick={() => setSelectedCampaign('all')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> {t('backToAllCampaigns')}
          </Button>
        )}

        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {metricCards.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={loading ? '…' : metric.value}
              icon={metric.icon}
              color={metric.color}
              bg={metric.bg}
              trend={metric.trend}
              trendLoading={priorLoading}
              isPositiveTrend={metric.isPositiveTrend}
              onClick={() => setSelectedMetric(metric.metricKey)}
            />
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-1 text-sm font-semibold text-[var(--color-foreground)]">
                {t('spendOverTime')}
              </h3>
              <p className="mb-4 text-xs text-[var(--color-muted-foreground)]">
                {datePreset.replace('_', ' ')}
              </p>
              <AreaChart
                data={spendChartData}
                xKey="date"
                series={[{ key: 'spend', label: 'Spend', color: '#2563eb' }]}
                format="currency"
                height={280}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h3 className="mb-1 text-sm font-semibold text-[var(--color-foreground)]">
                {t('resultsOverTime')}
              </h3>
              <p className="mb-4 text-xs text-[var(--color-muted-foreground)]">
                {datePreset.replace('_', ' ')}
              </p>
              <BarChart
                data={resultsChartData}
                xKey="date"
                series={[{ key: 'results', label: tMetrics('results'), color: '#6366f1' }]}
                format="number"
                height={280}
              />
            </CardContent>
          </Card>
        </div>

        {/* Campaign Performance Table */}
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 text-sm font-semibold text-[var(--color-foreground)]">
              {t('campaignPerformance')}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {t('campaign')}
                    </th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {tCommon('status')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {tMetrics('spend')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {tMetrics('results')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {tMetrics('cpm')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {tMetrics('ctr')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {tMetrics('cpc')}
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                      {t('costResult')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-[var(--color-muted-foreground)]"
                      >
                        {tCommon('loading')}
                      </td>
                    </tr>
                  ) : activeCampaigns.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-[var(--color-muted-foreground)]"
                      >
                        {t('noCampaignsFound')}
                      </td>
                    </tr>
                  ) : (
                    activeCampaigns.map((campaign) => {
                      const i = campaign.insights;

                      return (
                        <tr
                          key={campaign.id}
                          className={`cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]/50 ${selectedCampaign === campaign.id ? 'bg-[var(--color-primary)]/5' : ''}`}
                          onClick={() => setSelectedCampaign(campaign.id)}
                        >
                          <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">
                            {campaign.name}
                          </td>
                          <td className="px-2 py-3">
                            <StatusBadge status={campaign.status} />
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                            {formatCurrency(i?.spend)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                            {formatNumber(getResults(i?.actions, campaign.result_action_type))}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                            {formatCurrency(i?.cpm)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                            {formatPercent(i?.ctr)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                            {formatCurrency(i?.cost_per_inline_link_click)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                            {formatCurrency(
                              getCostPerResult(
                                i?.cost_per_action_type,
                                campaign.result_action_type,
                                i?.spend,
                                i?.actions
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Ad Set Drill-down */}
        {selectedCampaign !== 'all' && (
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-[var(--color-foreground)]">
                {t('adSetsFor', {
                  name: campaigns.find((c) => c.id === selectedCampaign)?.name ?? '',
                })}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {t('adSet')}
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tCommon('status')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('budget')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('spend')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('results')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('ctr')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--color-muted-foreground)] uppercase">
                        {tMetrics('cpc')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillLoading ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-8 text-center text-[var(--color-muted-foreground)]"
                        >
                          {t('loadingAdSets')}
                        </td>
                      </tr>
                    ) : drillAdSets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="py-8 text-center text-[var(--color-muted-foreground)]"
                        >
                          {t('noAdSetsFound')}
                        </td>
                      </tr>
                    ) : (
                      drillAdSets.map((adSet) => {
                        const i = adSet.insights;

                        return (
                          <tr
                            key={adSet.id}
                            className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]/50"
                          >
                            <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">
                              {adSet.name}
                            </td>
                            <td className="px-2 py-3">
                              <StatusBadge status={adSet.status} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              {editingBudget?.id === adSet.id ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-sm text-[var(--color-muted-foreground)]">
                                    $
                                  </span>
                                  <input
                                    type="number"
                                    className="w-20 rounded border border-[var(--color-primary)] bg-[var(--color-card)] px-1.5 py-0.5 text-right text-sm text-[var(--color-foreground)] focus:outline-none"
                                    value={editingBudget.value}
                                    onChange={(e) =>
                                      setEditingBudget({ ...editingBudget, value: e.target.value })
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleBudgetSave();
                                      if (e.key === 'Escape') setEditingBudget(null);
                                    }}
                                    autoFocus
                                    disabled={budgetMutation.isPending}
                                  />
                                  <button
                                    onClick={handleBudgetSave}
                                    className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                                    disabled={budgetMutation.isPending}
                                  >
                                    {budgetMutation.isPending ? '…' : '✓'}
                                  </button>
                                  <button
                                    onClick={() => setEditingBudget(null)}
                                    className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="cursor-pointer text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                                  onClick={() =>
                                    setEditingBudget({
                                      id: adSet.id,
                                      type: 'adset',
                                      value: adSet.daily_budget
                                        ? String(parseInt(adSet.daily_budget) / 100)
                                        : '',
                                    })
                                  }
                                  title="Click to edit budget"
                                >
                                  {adSet.daily_budget
                                    ? `$${(parseInt(adSet.daily_budget) / 100).toFixed(2)}`
                                    : '—'}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                              {formatCurrency(i?.spend)}
                            </td>
                            <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                              {formatNumber(getResults(i?.actions, selectedResultActionType))}
                            </td>
                            <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                              {formatPercent(i?.ctr)}
                            </td>
                            <td className="px-4 py-3 text-right text-[var(--color-foreground)]">
                              {formatCurrency(i?.cost_per_inline_link_click)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ad Performance */}
        {selectedCampaign !== 'all' && !drillLoading && drillAds.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-[var(--color-foreground)]">
                {t('adPerformance')}
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {drillAds.map((ad) => {
                  const i = ad.insights;

                  return (
                    <div
                      key={ad.id}
                      className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] transition-shadow hover:shadow-sm"
                    >
                      <div className="relative flex h-32 items-center justify-center bg-[var(--color-muted)]">
                        {ad.creative?.thumbnail_url || ad.creative?.image_url ? (
                          <NextImage
                            src={ad.creative.thumbnail_url || ad.creative.image_url!}
                            alt={ad.name}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-[var(--color-muted-foreground)]" />
                        )}
                        <div className="absolute top-1.5 right-1.5">
                          <StatusBadge status={ad.status} />
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="truncate text-xs font-medium text-[var(--color-foreground)]">
                          {ad.name}
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                          <div>
                            <span className="block text-[var(--color-muted-foreground)]">
                              {tMetrics('spend')}
                            </span>
                            <span className="font-medium text-[var(--color-foreground)]">
                              {formatCurrency(i?.spend)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[var(--color-muted-foreground)]">
                              {tMetrics('ctr')}
                            </span>
                            <span className="font-medium text-[var(--color-foreground)]">
                              {formatPercent(i?.ctr)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[var(--color-muted-foreground)]">
                              {tMetrics('cpc')}
                            </span>
                            <span className="font-medium text-[var(--color-foreground)]">
                              {formatCurrency(i?.cost_per_inline_link_click)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Stat detail slide panel */}
      {selectedMetric && (
        <StatDetailPanel
          metric={selectedMetric as 'spend' | 'results' | 'ctr' | 'cpm' | 'cpc' | 'cpr'}
          campaigns={activeCampaigns}
          open={!!selectedMetric}
          onClose={() => setSelectedMetric(null)}
        />
      )}
    </div>
  );
}
