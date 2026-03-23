'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { type ColumnDef } from '@tanstack/react-table';
import { Header } from '@/components/layout/header';
import { Card } from '@/components/ui/card';
import { DataTable, RowActions } from '@/components/data/data-table';
import { SlidePanel } from '@/components/data/slide-panel';
import { Select } from '@/components/ui/dropdown';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { useAppStore } from '@/stores/app-store';
import { useDashboardStore, METRIC_OPTIONS } from '@/stores/dashboard-store';
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
import { ChartWidget } from '@/components/dashboard/chart-widget';
import { AdsGallery } from '@/components/dashboard/ads-gallery';
import {
  DollarSign,
  Eye,
  MousePointer,
  Target,
  TrendingUp,
  BarChart3,
  ArrowLeft,
  RefreshCw,
  Plus,
  RotateCcw,
  Info,
  TableProperties,
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

  // Try conversions first
  const conversion = actions.find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.')) &&
      !ENGAGEMENT_TYPES.has(a.action_type)
  );

  if (conversion) return parseInt(conversion.value);

  // Fall back to link_click or landing_page_view as a result proxy
  const linkClick = actions.find(
    (a) => a.action_type === 'link_click' || a.action_type === 'landing_page_view'
  );

  if (linkClick) return parseInt(linkClick.value);

  // Last resort: any action that isn't a vanity metric
  const anyAction = actions.find(
    (a) => a.action_type !== 'impressions' && a.action_type !== 'reach'
  );

  return anyAction ? parseInt(anyAction.value) : 0;
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

      // Fall back to link_click cost
      const linkClickCost = costPerAction.find(
        (a) => a.action_type === 'link_click' || a.action_type === 'landing_page_view'
      );

      if (linkClickCost) return parseFloat(linkClickCost.value);
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
      acc.reach += parseInt(c.insights.reach || '0');
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
      reach: 0,
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
  const tCampaigns = useTranslations('campaigns');
  const { datePreset } = useAppStore();
  const { widgets, setWidgets, addWidget, resetWidgets } = useDashboardStore();
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [detailAdSet, setDetailAdSet] = useState<AdSetRow | null>(null);

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

    // When viewing all campaigns and campaign-level insights are empty,
    // fall back to account-level time-series totals (which come from a
    // different API endpoint and are more reliable).
    const hasCampaignInsights = activeCampaigns.some((c) => c.insights !== null);

    if (!hasCampaignInsights && selectedCampaign === 'all' && timeSeries.length > 0) {
      for (const row of timeSeries) {
        t.spend += parseFloat(row.spend || '0');
        t.impressions += parseInt(row.impressions || '0');
        t.clicks += parseInt(row.clicks || '0');
        t.reach += parseInt(row.reach || '0');
        const rowResults = getResults(row.actions, null);

        t.results += rowResults;

        if (rowResults > 0) {
          const rowSpend = parseFloat(row.spend || '0');

          t.costPerResultSum += rowSpend;
          t.costPerResultCount += rowResults;
        }
      }
    }

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
      cpcNum = t.clicks > 0 ? t.spend / t.clicks : 0;
      cpm = t.impressions > 0 ? formatCurrency(cpmNum) : '-';
      ctr = t.impressions > 0 ? formatPercent(ctrNum) : '-';
      cpc = t.clicks > 0 ? formatCurrency(cpcNum) : '-';
    }

    const priorCpmNum = prior.impressions > 0 ? (prior.spend / prior.impressions) * 1000 : 0;
    const priorCtrNum = prior.impressions > 0 ? (prior.clicks / prior.impressions) * 100 : 0;
    const priorCpcNum = prior.linkClicks > 0 ? prior.spend / prior.linkClicks : 0;

    // Build sparkline data from time-series for each metric
    const spendSpark = timeSeries.map((r) => parseFloat(r.spend || '0'));
    const cpmSpark = timeSeries.map((r) => {
      const imp = parseInt(r.impressions || '0');
      const sp = parseFloat(r.spend || '0');

      return imp > 0 ? (sp / imp) * 1000 : 0;
    });
    const ctrSpark = timeSeries.map((r) => parseFloat(r.ctr || '0'));
    const cpcSpark = timeSeries.map((r) => {
      const cl = parseInt(r.clicks || '0');
      const sp = parseFloat(r.spend || '0');

      return cl > 0 ? sp / cl : 0;
    });
    const resultsSpark = timeSeries.map((r) => getResults(r.actions, selectedResultActionType));

    const cards = [
      {
        label: tMetrics('amountSpent'),
        value: formatCurrency(t.spend),
        icon: DollarSign,
        color: 'text-emerald-600',
        bg: 'bg-emerald-100',
        accent: '#10b981',
        metricKey: 'spend' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(t.spend, prior.spend) : null,
        isPositiveTrend: false,
        sparklineData: spendSpark,
      },
      {
        label: tMetrics('cpm'),
        value: cpm,
        icon: Eye,
        color: 'text-blue-600',
        bg: 'bg-blue-100',
        accent: '#3b82f6',
        metricKey: 'cpm' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(cpmNum, priorCpmNum) : null,
        isPositiveTrend: false,
        sparklineData: cpmSpark,
      },
      {
        label: tMetrics('ctr'),
        value: ctr,
        icon: MousePointer,
        color: 'text-purple-600',
        bg: 'bg-purple-100',
        accent: '#8b5cf6',
        metricKey: 'ctr' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(ctrNum, priorCtrNum) : null,
        isPositiveTrend: true,
        sparklineData: ctrSpark,
      },
      {
        label: tMetrics('cpc'),
        value: cpc,
        icon: TrendingUp,
        color: 'text-amber-600',
        bg: 'bg-amber-100',
        accent: '#f59e0b',
        metricKey: 'cpc' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(cpcNum, priorCpcNum) : null,
        isPositiveTrend: false,
        sparklineData: cpcSpark,
      },
      {
        label: tMetrics('results'),
        value: formatNumber(t.results),
        icon: Target,
        color: 'text-rose-600',
        bg: 'bg-rose-100',
        accent: '#f43f5e',
        metricKey: 'results' as const,
        trend: priorCampaigns.length > 0 ? formatTrend(t.results, prior.results) : null,
        isPositiveTrend: true,
        sparklineData: resultsSpark,
      },
      {
        label: tMetrics('costPerResult'),
        value: cpr !== null ? formatCurrency(cpr) : '-',
        icon: BarChart3,
        color: 'text-indigo-600',
        bg: 'bg-indigo-100',
        accent: '#6366f1',
        metricKey: 'cpr' as const,
        trend:
          priorCampaigns.length > 0 && cpr !== null && priorCpr !== null
            ? formatTrend(cpr, priorCpr)
            : null,
        isPositiveTrend: false,
      },
    ];

    return { metricCards: cards };
    // tMetrics is a stable ref from next-intl — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaigns, priorCampaigns, selectedCampaign, timeSeries]);

  /** Build chart data for all metrics from time-series rows. */
  const chartDataByMetric = useMemo(() => {
    return timeSeries.map((row) => {
      const spend = parseFloat(row.spend || '0');
      const impressions = parseInt(row.impressions || '0');
      const clicks = parseInt(row.clicks || '0');
      const results = getResults(row.actions, selectedResultActionType);

      return {
        date: row.date_start?.split('T')[0]?.slice(5) || '',
        spend,
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        results,
        cpr: results > 0 ? spend / results : 0,
        reach: parseInt(row.reach || '0'),
      };
    });
  }, [timeSeries, selectedResultActionType]);

  const campaignOptions = [
    { label: tCommon('allCampaigns'), value: 'all' },
    ...campaigns.map((c) => ({ label: c.name, value: c.id })),
  ];

  /* ---------- Table column definitions ---------- */

  const campaignColumns = useMemo<ColumnDef<CampaignRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('campaign'),
        minSize: 180,
        cell: ({ row }) => {
          const isSelected = selectedCampaign === row.original.id;

          return (
            <div className="flex items-center gap-2">
              {isSelected && <div className="h-5 w-0.5 rounded-full bg-[var(--color-primary)]" />}
              <span className="font-medium text-[var(--color-foreground)]">
                {row.original.name}
              </span>
            </div>
          );
        },
        enableSorting: true,
      },
      {
        accessorKey: 'status',
        header: tCommon('status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        enableSorting: true,
      },
      {
        id: 'spend',
        header: tMetrics('spend'),
        accessorFn: (row) => parseFloat(row.insights?.spend || '0'),
        cell: ({ row }) => formatCurrency(row.original.insights?.spend),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'results',
        header: tMetrics('results'),
        accessorFn: (row) => getResults(row.insights?.actions, row.result_action_type),
        cell: ({ row }) =>
          formatNumber(getResults(row.original.insights?.actions, row.original.result_action_type)),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'cpm',
        header: tMetrics('cpm'),
        accessorFn: (row) => parseFloat(row.insights?.cpm || '0'),
        cell: ({ row }) => formatCurrency(row.original.insights?.cpm),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'ctr',
        header: tMetrics('ctr'),
        accessorFn: (row) => parseFloat(row.insights?.ctr || '0'),
        cell: ({ row }) => formatPercent(row.original.insights?.ctr),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'cpc',
        header: tMetrics('cpc'),
        accessorFn: (row) => parseFloat(row.insights?.cost_per_inline_link_click || '0'),
        cell: ({ row }) => formatCurrency(row.original.insights?.cost_per_inline_link_click),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'costPerResult',
        header: t('costResult'),
        accessorFn: (row) =>
          getCostPerResult(
            row.insights?.cost_per_action_type,
            row.result_action_type,
            row.insights?.spend,
            row.insights?.actions
          ) ?? 0,
        cell: ({ row }) =>
          formatCurrency(
            getCostPerResult(
              row.original.insights?.cost_per_action_type,
              row.original.result_action_type,
              row.original.insights?.spend,
              row.original.insights?.actions
            )
          ),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'actions',
        header: '',
        size: 120,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            actions={[
              {
                id: 'viewDetails',
                label: tCampaigns('viewDetails'),
                icon: Info,
                onClick: (campaign) => setDetailCampaign(campaign),
              },
              {
                id: 'viewAdSets',
                label: t('viewAdSets'),
                icon: TableProperties,
                onClick: (campaign) => setSelectedCampaign(campaign.id),
              },
            ]}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translation fns are stable refs
    [selectedCampaign]
  );

  const adSetColumns = useMemo<ColumnDef<AdSetRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('adSet'),
        minSize: 180,
        cell: ({ row }) => (
          <span className="font-medium text-[var(--color-foreground)]">{row.original.name}</span>
        ),
        enableSorting: true,
      },
      {
        accessorKey: 'status',
        header: tCommon('status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        enableSorting: true,
      },
      {
        id: 'budget',
        header: tMetrics('budget'),
        accessorFn: (row) => (row.daily_budget ? parseInt(row.daily_budget) / 100 : 0),
        cell: ({ row }) => {
          const adSet = row.original;

          if (editingBudget?.id === adSet.id) {
            return (
              <div className="flex items-center justify-end gap-1">
                <span className="text-sm text-[var(--color-muted-foreground)]">$</span>
                <input
                  type="number"
                  className="w-20 rounded border border-[var(--color-primary)] bg-[var(--color-card)] px-1.5 py-0.5 text-right text-sm text-[var(--color-foreground)] focus:outline-none"
                  value={editingBudget.value}
                  onChange={(e) => setEditingBudget({ ...editingBudget, value: e.target.value })}
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
            );
          }

          return (
            <button
              className="cursor-pointer text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setEditingBudget({
                  id: adSet.id,
                  type: 'adset',
                  value: adSet.daily_budget ? String(parseInt(adSet.daily_budget) / 100) : '',
                });
              }}
              title={t('clickToEditBudget')}
            >
              {adSet.daily_budget ? `$${(parseInt(adSet.daily_budget) / 100).toFixed(2)}` : '—'}
            </button>
          );
        },
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'spend',
        header: tMetrics('spend'),
        accessorFn: (row) => parseFloat(row.insights?.spend || '0'),
        cell: ({ row }) => formatCurrency(row.original.insights?.spend),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'results',
        header: tMetrics('results'),
        accessorFn: (row) => getResults(row.insights?.actions, selectedResultActionType),
        cell: ({ row }) =>
          formatNumber(getResults(row.original.insights?.actions, selectedResultActionType)),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'ctr',
        header: tMetrics('ctr'),
        accessorFn: (row) => parseFloat(row.insights?.ctr || '0'),
        cell: ({ row }) => formatPercent(row.original.insights?.ctr),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'cpc',
        header: tMetrics('cpc'),
        accessorFn: (row) => parseFloat(row.insights?.cost_per_inline_link_click || '0'),
        cell: ({ row }) => formatCurrency(row.original.insights?.cost_per_inline_link_click),
        meta: { align: 'right' },
        enableSorting: true,
      },
      {
        id: 'actions',
        header: '',
        size: 80,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            actions={[
              {
                id: 'viewDetails',
                label: tCampaigns('viewDetails'),
                icon: Info,
                onClick: (adSet) => setDetailAdSet(adSet),
              },
            ]}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translation fns are stable refs
    [editingBudget, budgetMutation.isPending, selectedResultActionType]
  );

  /* ---------- Drag & Drop ---------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = widgets.findIndex((w) => w.id === active.id);
        const newIndex = widgets.findIndex((w) => w.id === over.id);

        setWidgets(arrayMove(widgets, oldIndex, newIndex));
      }
    },
    [widgets, setWidgets]
  );

  const canAddWidget = widgets.length < Object.keys(METRIC_OPTIONS).length;

  if (loading && campaigns.length === 0) {
    return <DashboardSkeleton />;
  }

  return (
    <div>
      <Header title={t('title')} description={t('description')}>
        <Select
          value={selectedCampaign}
          onChange={setSelectedCampaign}
          options={campaignOptions}
          className="h-8 min-w-0 flex-1 truncate text-xs sm:max-w-xs sm:text-sm"
        />
        {campaignsFetching && (
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />
        )}
      </Header>

      <div className="space-y-5 p-4 sm:p-6 lg:p-8">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {metricCards.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={loading ? '…' : metric.value}
              icon={metric.icon}
              color={metric.color}
              bg={metric.bg}
              accent={metric.accent}
              trend={metric.trend}
              trendLoading={priorLoading}
              isPositiveTrend={metric.isPositiveTrend}
              sparklineData={metric.sparklineData}
              onClick={() => setSelectedMetric(metric.metricKey)}
            />
          ))}
        </div>

        {/* Charts — drag & drop */}
        <div>
          <div className="mb-3 flex items-center justify-end gap-2">
            {canAddWidget && (
              <Button variant="outline" size="sm" onClick={addWidget}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addChart')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={resetWidgets}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              {t('resetLayout')}
            </Button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {widgets.map((widget) => (
                  <ChartWidget
                    key={widget.id}
                    widget={widget}
                    data={chartDataByMetric}
                    datePreset={datePreset}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Campaign Performance Table */}
        <DataTable
          columns={campaignColumns}
          data={activeCampaigns}
          title={t('campaignPerformance')}
          headerAction={
            selectedCampaign !== 'all' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCampaign('all')}
                className="h-7 gap-1.5 text-xs"
              >
                <ArrowLeft className="h-3 w-3" />
                {tCommon('allCampaigns')}
              </Button>
            ) : undefined
          }
          isLoading={loading}
          emptyMessage={t('noCampaignsFound')}
          searchKey="name"
          searchPlaceholder={t('campaign')}
          pagination={activeCampaigns.length > 10}
          onRowClick={(campaign) => setSelectedCampaign(campaign.id)}
        />

        {/* Ad Set Drill-down */}
        {selectedCampaign !== 'all' && (
          <div className="relative overflow-hidden rounded-xl">
            {drillLoading && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center backdrop-blur-[3px]"
                style={{ background: 'color-mix(in srgb, var(--color-card) 80%, transparent)' }}
              >
                <RefreshCw className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
              </div>
            )}
            <DataTable
              columns={adSetColumns}
              data={drillAdSets}
              title={t('adSetsFor', {
                name: campaigns.find((c) => c.id === selectedCampaign)?.name ?? '',
              })}
              isLoading={false}
              emptyMessage={t('noAdSetsFound')}
              searchKey="name"
              searchPlaceholder={t('adSet')}
              pagination={false}
            />
          </div>
        )}

        {/* Ad Performance — uses the AdsGallery carousel with click-to-detail modal */}
        {selectedCampaign !== 'all' && !drillLoading && drillAds.length > 0 && (
          <Card className="overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-4 py-3 md:px-5">
              <h3 className="text-sm font-medium text-[var(--color-foreground)]">
                {t('adPerformance')}
              </h3>
            </div>
            <div className="p-4 md:p-5">
              <AdsGallery
                ads={drillAds
                  .map((ad, idx) => {
                    const results = getResults(ad.insights?.actions, selectedResultActionType);
                    const spend = parseFloat(ad.insights?.spend || '0');

                    return {
                      ...ad,
                      results,
                      cpa: results > 0 ? spend / results : null,
                      rank: idx + 1,
                    };
                  })
                  .sort((a, b) => b.results - a.results)
                  .map((ad, idx) => ({ ...ad, rank: idx + 1 }))}
              />
            </div>
          </Card>
        )}
      </div>

      {/* Campaign detail panel */}
      <SlidePanel
        open={!!detailCampaign}
        onOpenChange={(open) => !open && setDetailCampaign(null)}
        title={detailCampaign?.name ?? ''}
        description={detailCampaign?.objective
          ?.replace('OUTCOME_', '')
          .replace(/_/g, ' ')
          .toLowerCase()}
      >
        {detailCampaign && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tCommon('status')}
                </p>
                <StatusBadge status={detailCampaign.status} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tMetrics('budget')}
                </p>
                <p className="text-sm text-[var(--color-foreground)]">
                  {detailCampaign.daily_budget
                    ? `${formatCurrency(parseFloat(detailCampaign.daily_budget))} / day`
                    : detailCampaign.lifetime_budget
                      ? `${formatCurrency(parseFloat(detailCampaign.lifetime_budget))} lifetime`
                      : '—'}
                </p>
              </div>
            </div>
            {detailCampaign.insights && (
              <div>
                <p className="mb-3 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tMetrics('performance')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: tMetrics('spend'),
                      value: formatCurrency(parseFloat(detailCampaign.insights.spend || '0')),
                    },
                    {
                      label: tMetrics('impressions'),
                      value: formatNumber(parseInt(detailCampaign.insights.impressions || '0', 10)),
                    },
                    {
                      label: tMetrics('clicks'),
                      value: formatNumber(parseInt(detailCampaign.insights.clicks || '0', 10)),
                    },
                    {
                      label: tMetrics('ctr'),
                      value: formatPercent(parseFloat(detailCampaign.insights.ctr || '0')),
                    },
                    {
                      label: tMetrics('cpc'),
                      value: formatCurrency(parseFloat(detailCampaign.insights.cpc || '0')),
                    },
                    {
                      label: tMetrics('cpm'),
                      value: formatCurrency(parseFloat(detailCampaign.insights.cpm || '0')),
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-[var(--color-accent)]/40 px-3 py-2.5">
                      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
                      <p className="mt-0.5 text-sm font-medium text-[var(--color-foreground)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4">
              <div>
                <p className="mb-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tCommon('created')}
                </p>
                <p className="text-sm text-[var(--color-foreground)]">
                  {detailCampaign.created_time
                    ? new Date(detailCampaign.created_time).toLocaleDateString()
                    : '—'}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tCommon('updated')}
                </p>
                <p className="text-sm text-[var(--color-foreground)]">
                  {detailCampaign.updated_time
                    ? new Date(detailCampaign.updated_time).toLocaleDateString()
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        )}
      </SlidePanel>

      {/* Ad set detail panel */}
      <SlidePanel
        open={!!detailAdSet}
        onOpenChange={(open) => !open && setDetailAdSet(null)}
        title={detailAdSet?.name ?? ''}
        description={detailAdSet?.campaign?.name}
      >
        {detailAdSet && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tCommon('status')}
                </p>
                <StatusBadge status={detailAdSet.status} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tMetrics('budget')}
                </p>
                <p className="text-sm text-[var(--color-foreground)]">
                  {detailAdSet.daily_budget
                    ? `${formatCurrency(parseInt(detailAdSet.daily_budget) / 100)} / day`
                    : detailAdSet.lifetime_budget
                      ? `${formatCurrency(parseInt(detailAdSet.lifetime_budget) / 100)} lifetime`
                      : '—'}
                </p>
              </div>
            </div>
            {detailAdSet.insights && (
              <div>
                <p className="mb-3 text-xs font-medium tracking-wider text-[var(--color-muted-foreground)] uppercase">
                  {tMetrics('performance')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: tMetrics('spend'),
                      value: formatCurrency(parseFloat(detailAdSet.insights.spend || '0')),
                    },
                    {
                      label: tMetrics('impressions'),
                      value: formatNumber(parseInt(detailAdSet.insights.impressions || '0', 10)),
                    },
                    {
                      label: tMetrics('clicks'),
                      value: formatNumber(parseInt(detailAdSet.insights.clicks || '0', 10)),
                    },
                    {
                      label: tMetrics('ctr'),
                      value: formatPercent(parseFloat(detailAdSet.insights.ctr || '0')),
                    },
                    {
                      label: tMetrics('cpc'),
                      value: formatCurrency(
                        parseFloat(detailAdSet.insights.cost_per_inline_link_click || '0')
                      ),
                    },
                    {
                      label: tMetrics('cpm'),
                      value: formatCurrency(parseFloat(detailAdSet.insights.cpm || '0')),
                    },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-[var(--color-accent)]/40 px-3 py-2.5">
                      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
                      <p className="mt-0.5 text-sm font-medium text-[var(--color-foreground)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SlidePanel>

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
