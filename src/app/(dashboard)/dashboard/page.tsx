'use client';

import { useState, useMemo } from 'react';
import NextImage from 'next/image';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/app-store';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { useCampaigns } from '@/lib/queries/meta/use-campaigns';
import {
  useDashboardInsights,
  useDrillDown,
  useBudgetMutation,
} from '@/lib/queries/meta/use-dashboard';
import type { AdSetRow } from '@/lib/queries/meta/use-adsets';
import { DashboardSkeleton } from '@/components/skeletons/dashboard-skeleton';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import {
  DollarSign,
  Eye,
  MousePointer,
  Target,
  TrendingUp,
  BarChart3,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { createLogger } from '@/services/logger';

const logger = createLogger('Dashboard');

/* ---------- Types ---------- */

/* ---------- Helpers ---------- */

/**
 * Get the "Results" count for a campaign.
 *
 * If `resultActionType` is provided (from the campaign's ad set optimization_goal
 * + promoted_object), we ONLY count that specific action type. This matches how
 * Meta's own UI computes "Results" — only the campaign's optimization event counts.
 *
 * If `resultActionType` is NOT provided (e.g., optimization data unavailable),
 * we fall back to a best-effort generic search.
 */
function getResults(
  actions?: Array<{ action_type: string; value: string }>,
  resultActionType?: string | null
) {
  if (!actions) return 0;

  // If we know the campaign's specific result action type, ONLY count that
  if (resultActionType) {
    const found = actions.find((a) => a.action_type === resultActionType);

    return found ? parseInt(found.value) : 0;
  }

  // Fallback: generic search for ANY offsite/onsite conversion
  // (only used when optimization data is unavailable)
  const conversion = actions.find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.')) &&
      !ENGAGEMENT_TYPES.has(a.action_type)
  );

  return conversion ? parseInt(conversion.value) : 0;
}

/**
 * Engagement-only action types — NEVER count these as "results".
 */
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

function getCostPerResult(
  costPerAction?: Array<{ action_type: string; value: string }>,
  resultActionType?: string | null,
  spend?: string | null,
  actions?: Array<{ action_type: string; value: string }> | null
) {
  // Try to find exact cost_per_action_type match first
  if (costPerAction) {
    if (resultActionType) {
      const found = costPerAction.find((a) => a.action_type === resultActionType);

      if (found) return parseFloat(found.value);
    } else {
      // Fallback: generic search
      const conversion = costPerAction.find(
        (a) =>
          (a.action_type.startsWith('offsite_conversion.') ||
            a.action_type.startsWith('onsite_conversion.')) &&
          !ENGAGEMENT_TYPES.has(a.action_type)
      );

      if (conversion) return parseFloat(conversion.value);
    }
  }

  // Fallback: calculate spend / results when cost_per_action_type doesn't have a match
  if (spend && actions) {
    const results = getResults(actions, resultActionType);

    if (results > 0) {
      return parseFloat(spend) / results;
    }
  }

  return null;
}

/* ---------- Component ---------- */

export default function DashboardPage() {
  const { datePreset } = useAppStore();
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');

  // TanStack Query hooks
  const {
    data: campaigns = [],
    isLoading: campaignsLoading,
    isFetching: campaignsFetching,
  } = useCampaigns(datePreset);
  const { data: timeSeries = [], isLoading: insightsLoading } = useDashboardInsights(datePreset);
  const {
    adSets: drillAdSets,
    ads: drillAds,
    isLoading: drillLoading,
  } = useDrillDown(selectedCampaign, datePreset);
  const budgetMutation = useBudgetMutation();

  const loading = campaignsLoading || insightsLoading;

  // Inline budget editing
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

  const handleSelectCampaign = (campaignId: string) => {
    setSelectedCampaign(campaignId);
  };

  /* ---------- Compute summary metrics ---------- */
  // Use Meta's own CPM/CTR/CPC values directly when single campaign is selected
  const activeCampaigns = useMemo(
    () =>
      selectedCampaign === 'all' ? campaigns : campaigns.filter((c) => c.id === selectedCampaign),
    [campaigns, selectedCampaign]
  );

  // For drill-down: the selected campaign's result action type
  const selectedResultActionType =
    selectedCampaign !== 'all'
      ? (campaigns.find((c) => c.id === selectedCampaign)?.result_action_type ?? null)
      : null;

  const { dateRange, metricCards } = useMemo(() => {
    const t = activeCampaigns.reduce(
      (acc, c) => {
        if (!c.insights) return acc;
        acc.spend += parseFloat(c.insights.spend || '0');
        acc.impressions += parseInt(c.insights.impressions || '0');
        acc.clicks += parseInt(c.insights.clicks || '0');
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
        results: 0,
        costPerResultSum: 0,
        costPerResultCount: 0,
      }
    );

    // Single campaign → use Meta's exact CPM/CTR/CPC. Multiple → weighted average.
    let cpm: string;
    let ctr: string;
    let cpc: string;

    if (selectedCampaign !== 'all' && activeCampaigns.length === 1 && activeCampaigns[0].insights) {
      const i = activeCampaigns[0].insights;

      cpm = formatCurrency(parseFloat(i.cpm || '0'));
      ctr = formatPercent(parseFloat(i.ctr || '0'));
      // Use cost_per_inline_link_click to match Meta UI's "CPC (cost per link click)"
      cpc = i.cost_per_inline_link_click
        ? formatCurrency(parseFloat(i.cost_per_inline_link_click))
        : '-';
    } else {
      // For "all campaigns", calculate weighted CPC from link clicks
      const totalLinkClicks = activeCampaigns.reduce((sum, c) => {
        return sum + parseInt(c.insights?.inline_link_clicks || '0');
      }, 0);

      cpm = t.impressions > 0 ? formatCurrency((t.spend / t.impressions) * 1000) : '-';
      ctr = t.impressions > 0 ? formatPercent((t.clicks / t.impressions) * 100) : '-';
      cpc = totalLinkClicks > 0 ? formatCurrency(t.spend / totalLinkClicks) : '-';
    }

    const cpr = t.costPerResultCount > 0 ? t.costPerResultSum / t.costPerResultCount : null;

    // Debug: check the date range being returned
    const firstCampaignInsights = activeCampaigns.find((c) => c.insights)?.insights;
    const dr = firstCampaignInsights
      ? `${firstCampaignInsights.date_start || '?'} → ${firstCampaignInsights.date_stop || '?'}`
      : null;

    const cards = [
      {
        label: 'Amount Spent',
        value: formatCurrency(t.spend),
        icon: DollarSign,
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
      },
      { label: 'CPM', value: cpm, icon: Eye, color: 'text-blue-600', bg: 'bg-blue-50' },
      {
        label: 'CTR',
        value: ctr,
        icon: MousePointer,
        color: 'text-purple-600',
        bg: 'bg-purple-50',
      },
      {
        label: 'CPC',
        value: cpc,
        icon: TrendingUp,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
      },
      {
        label: 'Results',
        value: formatNumber(t.results),
        icon: Target,
        color: 'text-rose-600',
        bg: 'bg-rose-50',
      },
      {
        label: 'Cost / Result',
        value: cpr !== null ? formatCurrency(cpr) : '-',
        icon: BarChart3,
        color: 'text-indigo-600',
        bg: 'bg-indigo-50',
      },
    ];

    return {
      totals: t,
      costPerResult: cpr,
      displayCpm: cpm,
      displayCtr: ctr,
      displayCpc: cpc,
      dateRange: dr,
      metricCards: cards,
    };
  }, [activeCampaigns, selectedCampaign]);

  const chartData = useMemo(
    () =>
      timeSeries.map((row) => ({
        date: row.date_start?.split('T')[0]?.slice(5) || '',
        spend: parseFloat(row.spend || '0'),
        clicks: parseInt(row.clicks || '0'),
        ctr: parseFloat(row.ctr || '0'),
      })),
    [timeSeries]
  );

  const campaignOptions = [
    { label: 'All Campaigns', value: 'all' },
    ...campaigns.map((c) => ({ label: c.name, value: c.id })),
  ];

  if (loading && campaigns.length === 0) {
    return <DashboardSkeleton />;
  }

  return (
    <div>
      <Header title="Dashboard" description="Overview of your ad account performance">
        <div className="flex items-center gap-3">
          {campaignsFetching && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />}
          <SelectNative
            value={selectedCampaign}
            onChange={(e) => handleSelectCampaign(e.target.value)}
            options={campaignOptions}
            className="w-72"
          />
        </div>
      </Header>

      <div className="space-y-8 p-8">
        {selectedCampaign !== 'all' && (
          <Button variant="ghost" size="sm" onClick={() => handleSelectCampaign('all')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to all campaigns
          </Button>
        )}

        {/* Debug: date range from Meta API */}
        {dateRange && (
          <p className="text-xs text-gray-400">
            Data range from Meta: {dateRange} (preset: {datePreset})
          </p>
        )}

        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {metricCards.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${metric.bg}`}
                  >
                    <metric.icon className={`h-5 w-5 ${metric.color}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium tracking-wider text-gray-500 uppercase">
                      {metric.label}
                    </p>
                    <p className="mt-0.5 text-xl font-bold text-gray-900">
                      {loading ? '...' : metric.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-900">Spend Over Time</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      fontSize: '13px',
                    }}
                    formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Spend']}
                  />
                  <Area
                    type="monotone"
                    dataKey="spend"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#spendGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-900">Clicks & CTR</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis yAxisId="clicks" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                  <YAxis
                    yAxisId="ctr"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb',
                      fontSize: '13px',
                    }}
                  />
                  <Legend />
                  <Bar
                    yAxisId="clicks"
                    dataKey="clicks"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                    barSize={20}
                  />
                  <Bar
                    yAxisId="ctr"
                    dataKey="ctr"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    barSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Campaign Performance Table */}
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">Campaign Performance</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Campaign
                    </th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Spend
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Results
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      CPM
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      CTR
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      CPC
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Cost/Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        Loading...
                      </td>
                    </tr>
                  ) : activeCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        No campaigns found
                      </td>
                    </tr>
                  ) : (
                    activeCampaigns.map((campaign) => {
                      const i = campaign.insights;

                      return (
                        <tr
                          key={campaign.id}
                          className={`cursor-pointer border-b border-gray-50 hover:bg-gray-50/50 ${selectedCampaign === campaign.id ? 'bg-blue-50/50' : ''}`}
                          onClick={() => handleSelectCampaign(campaign.id)}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">{campaign.name}</td>
                          <td className="px-2 py-3">
                            <StatusBadge status={campaign.status} />
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatCurrency(i?.spend)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatNumber(getResults(i?.actions, campaign.result_action_type))}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatCurrency(i?.cpm)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatPercent(i?.ctr)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
                            {formatCurrency(i?.cost_per_inline_link_click)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">
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

        {/* Ad Set Performance (fetched server-side by campaign_id) */}
        {selectedCampaign !== 'all' && (
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-900">
                Ad Set Performance — {campaigns.find((c) => c.id === selectedCampaign)?.name}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Ad Set
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Budget
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Spend
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Results
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        CPM
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        CTR
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        CPC
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Cost/Result
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillLoading ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-gray-400">
                          Loading ad sets...
                        </td>
                      </tr>
                    ) : drillAdSets.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-gray-400">
                          No ad sets found
                        </td>
                      </tr>
                    ) : (
                      drillAdSets.map((adSet) => {
                        const i = adSet.insights;

                        return (
                          <tr
                            key={adSet.id}
                            className="border-b border-gray-50 hover:bg-gray-50/50"
                          >
                            <td className="px-4 py-3 font-medium text-gray-900">{adSet.name}</td>
                            <td className="px-2 py-3">
                              <StatusBadge status={adSet.status} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              {editingBudget?.id === adSet.id ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-sm text-gray-400">$</span>
                                  <input
                                    type="number"
                                    className="w-20 rounded border border-blue-400 px-1.5 py-0.5 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                    value={editingBudget.value}
                                    onChange={(e) =>
                                      setEditingBudget({
                                        ...editingBudget,
                                        value: e.target.value,
                                      })
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
                                    className="text-xs font-medium text-green-600 hover:text-green-700"
                                    disabled={budgetMutation.isPending}
                                  >
                                    {budgetMutation.isPending ? '...' : '✓'}
                                  </button>
                                  <button
                                    onClick={() => setEditingBudget(null)}
                                    className="text-xs text-gray-400 hover:text-gray-600"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="cursor-pointer text-gray-700 hover:text-blue-600 hover:underline"
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
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatCurrency(i?.spend)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatNumber(getResults(i?.actions, selectedResultActionType))}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatCurrency(i?.cpm)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatPercent(i?.ctr)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatCurrency(i?.cost_per_inline_link_click)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-700">
                              {formatCurrency(
                                getCostPerResult(
                                  i?.cost_per_action_type,
                                  selectedResultActionType,
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
        )}

        {/* Ad Performance */}
        {selectedCampaign !== 'all' && !drillLoading && drillAds.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-900">Ad Performance</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {drillAds.map((ad) => {
                  const i = ad.insights;

                  return (
                    <div
                      key={ad.id}
                      className="overflow-hidden rounded-lg border border-gray-200 transition-shadow hover:shadow-sm"
                    >
                      <div className="relative flex h-32 items-center justify-center bg-gray-100">
                        {ad.creative?.thumbnail_url || ad.creative?.image_url ? (
                          <NextImage
                            src={ad.creative.thumbnail_url || ad.creative.image_url!}
                            alt={ad.name}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <span className="text-xs text-gray-400">No image</span>
                        )}
                        <div className="absolute top-1.5 right-1.5">
                          <StatusBadge status={ad.status} />
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="truncate text-xs font-medium text-gray-900">{ad.name}</p>
                        <div className="mt-2 grid grid-cols-3 gap-1 text-xs">
                          <div>
                            <span className="block text-gray-400">Spend</span>
                            <span className="font-medium">{formatCurrency(i?.spend)}</span>
                          </div>
                          <div>
                            <span className="block text-gray-400">CTR</span>
                            <span className="font-medium">{formatPercent(i?.ctr)}</span>
                          </div>
                          <div>
                            <span className="block text-gray-400">CPC</span>
                            <span className="font-medium">
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
    </div>
  );
}
