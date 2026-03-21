'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SlidePanel } from '@/components/data/slide-panel';
import { AreaChart } from '@/components/data/chart';
import { formatCurrency, formatPercent, formatNumber, DATE_PRESETS, cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { useCampaigns, type CampaignRow } from '@/lib/queries/meta/use-campaigns';
import { useDashboardInsights } from '@/lib/queries/meta/use-dashboard';
import { Loader2, Check, ChevronDown, Filter } from 'lucide-react';

type MetricKey = 'spend' | 'results' | 'ctr' | 'cpm' | 'cpc' | 'cpr';

const METRIC_CONFIG: Record<
  MetricKey,
  { label: string; format: 'currency' | 'percent' | 'number'; color: string; accent: string }
> = {
  spend: { label: 'Spend', format: 'currency', color: '#2563eb', accent: '#10b981' },
  results: { label: 'Results', format: 'number', color: '#10b981', accent: '#f43f5e' },
  ctr: { label: 'CTR', format: 'percent', color: '#f59e0b', accent: '#8b5cf6' },
  cpm: { label: 'CPM', format: 'currency', color: '#8b5cf6', accent: '#3b82f6' },
  cpc: { label: 'CPC', format: 'currency', color: '#06b6d4', accent: '#f59e0b' },
  cpr: { label: 'Cost per Result', format: 'currency', color: '#ef4444', accent: '#6366f1' },
};

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

function getResultsFromActions(
  actions?: Array<{ action_type: string; value: string }>,
  resultActionType?: string | null
): number {
  if (!actions) return 0;

  if (resultActionType) {
    const found = actions.find((a) => a.action_type === resultActionType);

    return found ? parseInt(found.value, 10) : 0;
  }

  const conversion = actions.find(
    (a) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.')) &&
      !ENGAGEMENT_TYPES.has(a.action_type)
  );

  if (conversion) return parseInt(conversion.value, 10);

  const linkClick = actions.find(
    (a) => a.action_type === 'link_click' || a.action_type === 'landing_page_view'
  );

  if (linkClick) return parseInt(linkClick.value, 10);

  const anyAction = actions.find(
    (a) => a.action_type !== 'impressions' && a.action_type !== 'reach'
  );

  return anyAction ? parseInt(anyAction.value, 10) : 0;
}

function getMetricValue(campaign: CampaignRow, metric: MetricKey): number {
  const ins = campaign.insights;

  if (!ins) return 0;

  switch (metric) {
    case 'spend':
      return parseFloat(ins.spend ?? '0');

    case 'results':
      return getResultsFromActions(ins.actions, campaign.result_action_type);

    case 'ctr':
      return parseFloat(ins.ctr ?? '0');
    case 'cpm':
      return parseFloat(ins.cpm ?? '0');
    case 'cpc':
      return parseFloat(ins.cpc ?? '0');

    case 'cpr': {
      const spend = parseFloat(ins.spend ?? '0');
      const results = getResultsFromActions(ins.actions, campaign.result_action_type);

      return results > 0 ? spend / results : 0;
    }
  }
}

function formatMetric(value: number, format: 'currency' | 'percent' | 'number'): string {
  if (format === 'currency') return formatCurrency(value);
  if (format === 'percent') return formatPercent(value);

  return formatNumber(value);
}

function computeTimeSeriesMetric(
  row: {
    spend: string;
    impressions: string;
    clicks: string;
    actions?: Array<{ action_type: string; value: string }>;
  },
  metric: MetricKey
): number {
  const spend = parseFloat(row.spend || '0');
  const impressions = parseInt(row.impressions || '0');
  const clicks = parseInt(row.clicks || '0');
  const results = getResultsFromActions(row.actions, null);

  switch (metric) {
    case 'spend':
      return spend;
    case 'cpm':
      return impressions > 0 ? (spend / impressions) * 1000 : 0;
    case 'ctr':
      return impressions > 0 ? (clicks / impressions) * 100 : 0;
    case 'cpc':
      return clicks > 0 ? spend / clicks : 0;
    case 'results':
      return results;
    case 'cpr':
      return results > 0 ? spend / results : 0;
  }
}

export interface StatDetailPanelProps {
  metric: MetricKey;
  campaigns: CampaignRow[];
  open: boolean;
  onClose: () => void;
}

/**
 * Slide-over panel showing per-campaign breakdown for a selected metric.
 *
 * @param metric - The metric to display ('spend', 'results', etc.)
 * @param campaigns - Current period campaign data from the dashboard
 * @param open - Whether the panel is visible
 * @param onClose - Close handler
 */
export function StatDetailPanel({ metric, campaigns, open, onClose }: StatDetailPanelProps) {
  const tCommon = useTranslations('common');
  const config = METRIC_CONFIG[metric];
  const globalDatePreset = useAppStore((s) => s.datePreset);
  const [localDatePreset, setLocalDatePreset] = useState<string | null>(null);
  const [showCount, setShowCount] = useState<number>(20);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [campaignFilterOpen, setCampaignFilterOpen] = useState(false);

  const datePreset = localDatePreset ?? globalDatePreset;

  const {
    data: fetchedCampaigns,
    isFetching: campaignsFetching,
    isPlaceholderData,
  } = useCampaigns(datePreset, { withInsights: true });
  const { data: timeSeries = [], isFetching: insightsFetching } = useDashboardInsights(datePreset);

  const isFetching = campaignsFetching || insightsFetching;
  const isStale = isPlaceholderData || (localDatePreset !== null && isFetching);

  const activeCampaigns = fetchedCampaigns ?? campaigns;
  const hasCampaignInsights = activeCampaigns.some((c) => c.insights !== null);

  const filteredCampaigns = useMemo(
    () =>
      selectedCampaignIds.size > 0
        ? activeCampaigns.filter((c) => selectedCampaignIds.has(c.id))
        : activeCampaigns,
    [activeCampaigns, selectedCampaignIds]
  );

  const timeSeriesTotal = useMemo(() => {
    if (hasCampaignInsights || timeSeries.length === 0) return null;

    let total = 0;

    for (const row of timeSeries) {
      total += computeTimeSeriesMetric(row, metric);
    }

    // For rate metrics (ctr, cpm, cpc, cpr), compute from totals not sum
    if (['ctr', 'cpm', 'cpc', 'cpr'].includes(metric)) {
      let spend = 0,
        impressions = 0,
        clicks = 0,
        results = 0;

      for (const row of timeSeries) {
        spend += parseFloat(row.spend || '0');
        impressions += parseInt(row.impressions || '0');
        clicks += parseInt(row.clicks || '0');
        results += getResultsFromActions(row.actions, null);
      }

      switch (metric) {
        case 'cpm':
          return impressions > 0 ? (spend / impressions) * 1000 : 0;
        case 'ctr':
          return impressions > 0 ? (clicks / impressions) * 100 : 0;
        case 'cpc':
          return clicks > 0 ? spend / clicks : 0;
        case 'cpr':
          return results > 0 ? spend / results : 0;
      }
    }

    return total;
  }, [hasCampaignInsights, timeSeries, metric]);

  const allRows = useMemo(
    () =>
      filteredCampaigns
        .map((c) => ({
          name: c.name,
          value: getMetricValue(c, metric),
          status: c.status,
        }))
        .sort((a, b) => b.value - a.value),
    [filteredCampaigns, metric]
  );

  const rows = allRows.slice(0, showCount);
  const maxValue = rows.length > 0 ? Math.max(...rows.map((r) => r.value)) : 1;
  const zeroCount = allRows.filter((r) => r.value === 0).length;
  const activeCount = allRows.filter((r) => r.status === 'ACTIVE').length;
  const pausedCount = allRows.length - activeCount;

  const chartData = rows.map((r) => ({
    name: r.name.length > 20 ? r.name.slice(0, 20) + '…' : r.name,
    [metric]: r.value,
  }));

  const campaignTotal = allRows.reduce((sum, r) => sum + r.value, 0);
  const total = campaignTotal > 0 ? campaignTotal : (timeSeriesTotal ?? 0);

  // For additive metrics (spend, results), show % share per campaign
  const isAdditive = metric === 'spend' || metric === 'results';

  const toggleCampaign = (id: string) => {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const filterLabel =
    selectedCampaignIds.size === 0
      ? tCommon('allCampaigns')
      : selectedCampaignIds.size === 1
        ? (activeCampaigns.find((c) => selectedCampaignIds.has(c.id))?.name ??
          tCommon('oneCampaign'))
        : tCommon('nCampaigns', { count: selectedCampaignIds.size });

  const dateLabel = DATE_PRESETS.find((p) => p.value === datePreset)?.label ?? datePreset;

  return (
    <SlidePanel
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={config.label}
      description={dateLabel}
    >
      {/* Controls row: date + campaign filter */}
      <div className="mb-6 space-y-3">
        {/* Date selector — horizontal scroll, no wrap */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5">
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                variant="ghost"
                size="sm"
                onClick={() =>
                  setLocalDatePreset(preset.value === globalDatePreset ? null : preset.value)
                }
                className={cn(
                  'h-auto shrink-0 px-2.5 py-1.5 text-[11px] whitespace-nowrap',
                  preset.value === datePreset
                    ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]'
                    : 'text-[var(--color-muted-foreground)]'
                )}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          {isFetching && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-muted-foreground)]" />
          )}
        </div>

        {/* Campaign filter */}
        {hasCampaignInsights && (
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCampaignFilterOpen((v) => !v)}
              className={cn(
                'w-full justify-start gap-2 px-3 py-2',
                selectedCampaignIds.size > 0
                  ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5'
                  : ''
              )}
            >
              <Filter className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
              <span className="flex-1 truncate text-[var(--color-foreground)]">{filterLabel}</span>
              {selectedCampaignIds.size > 0 && (
                <span className="shrink-0 rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary-foreground)]">
                  {selectedCampaignIds.size}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-200',
                  campaignFilterOpen && 'rotate-180'
                )}
              />
            </Button>
            {campaignFilterOpen && (
              <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-lg">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedCampaignIds(new Set());
                    setCampaignFilterOpen(false);
                  }}
                  className={cn(
                    'w-full justify-between px-3',
                    selectedCampaignIds.size === 0
                      ? 'bg-[var(--color-primary)]/5 font-medium text-[var(--color-primary)]'
                      : ''
                  )}
                >
                  <span>{tCommon('allCampaigns')}</span>
                  {selectedCampaignIds.size === 0 && (
                    <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                  )}
                </Button>
                <div className="mx-3 my-1 border-t border-[var(--color-border)]" />
                {activeCampaigns.map((c) => (
                  <Button
                    key={c.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleCampaign(c.id)}
                    className={cn(
                      'w-full justify-between px-3',
                      selectedCampaignIds.has(c.id) ? 'bg-[var(--color-primary)]/5' : ''
                    )}
                  >
                    <span className="truncate pr-2">{c.name}</span>
                    {selectedCampaignIds.has(c.id) && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content area — dims when stale */}
      <div className={cn('transition-opacity duration-200', isStale && 'opacity-50')}>
        {/* Summary card with accent */}
        <div
          className="relative mb-6 overflow-hidden rounded-xl p-5"
          style={{ backgroundColor: `${config.accent}10` }}
        >
          <div
            className="absolute top-0 left-0 h-full w-1"
            style={{ backgroundColor: config.accent }}
          />
          <div className="mb-3">
            <p className="mb-1 text-[11px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
              {tCommon('total') + ' '}
              {config.label}
            </p>
            <p className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]">
              {formatMetric(total, config.format)}
            </p>
          </div>
          {hasCampaignInsights && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-muted-foreground)]">
              <span>
                {filteredCampaigns.length}{' '}
                {filteredCampaigns.length !== 1 ? tCommon('campaigns') : tCommon('campaign')}
              </span>
              {activeCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {activeCount} {tCommon('active')}
                </span>
              )}
              {pausedCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {pausedCount} {tCommon('paused')}
                </span>
              )}
              {zeroCount > 0 && (
                <span>
                  {zeroCount} {tCommon('withNo')} {config.label.toLowerCase()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Quick stats — best, worst, average */}
        {hasCampaignInsights && allRows.length > 1 && (
          <div className="mb-6 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-[var(--color-muted)] p-3">
              <p className="text-[10px] font-medium tracking-wide text-emerald-500 uppercase">
                {tCommon('best')}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-foreground)]">
                {allRows[0].name}
              </p>
              <p className="mt-0.5 text-sm font-bold text-[var(--color-foreground)] tabular-nums">
                {formatMetric(allRows[0].value, config.format)}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--color-muted)] p-3">
              <p className="text-[10px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
                {tCommon('avg')}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">&nbsp;</p>
              <p className="mt-0.5 text-sm font-bold text-[var(--color-foreground)] tabular-nums">
                {formatMetric(campaignTotal / allRows.length, config.format)}
              </p>
            </div>
            <div className="rounded-lg bg-[var(--color-muted)] p-3">
              <p className="text-[10px] font-medium tracking-wide text-red-400 uppercase">
                {tCommon('worst')}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-foreground)]">
                {allRows[allRows.length - 1].name}
              </p>
              <p className="mt-0.5 text-sm font-bold text-[var(--color-foreground)] tabular-nums">
                {formatMetric(allRows[allRows.length - 1].value, config.format)}
              </p>
            </div>
          </div>
        )}

        {/* Trend over time — always show when time-series data exists */}
        {timeSeries.length > 1 && (
          <div className="mb-6">
            <p className="mb-3 text-[11px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
              {tCommon('trendOverTime')}
            </p>
            <AreaChart
              data={timeSeries.map((row) => ({
                name: row.date_start?.split('T')[0]?.slice(5) || '',
                [metric]: computeTimeSeriesMetric(row, metric),
              }))}
              xKey="name"
              series={[{ key: metric, label: config.label, color: config.accent }]}
              format={config.format}
              height={130}
            />
          </div>
        )}

        {/* Distribution by campaign */}
        {hasCampaignInsights && chartData.length > 1 && (
          <div className="mb-6">
            <p className="mb-3 text-[11px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
              {tCommon('distributionByCampaign')}
            </p>
            <AreaChart
              data={chartData}
              xKey="name"
              series={[{ key: metric, label: config.label, color: config.accent }]}
              format={config.format}
              height={130}
            />
          </div>
        )}

        {/* Campaign breakdown */}
        {hasCampaignInsights && (
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-[11px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
                {tCommon('campaignBreakdown')}
              </p>
              {/* Count selector */}
              <div className="flex items-center rounded-md border border-[var(--color-border)]">
                {[5, 10, 20]
                  .filter((n) => n <= allRows.length || n === 5)
                  .map((n, i, arr) => (
                    <Button
                      key={n}
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCount(n)}
                      className={cn(
                        'h-auto rounded-none px-2 py-1 text-[11px]',
                        i < arr.length - 1 && 'border-r border-[var(--color-border)]',
                        showCount === n
                          ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]'
                          : 'text-[var(--color-muted-foreground)]'
                      )}
                    >
                      {n}
                    </Button>
                  ))}
                {allRows.length > 20 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCount(Infinity)}
                    className={cn(
                      'h-auto rounded-none px-2 py-1 text-[11px]',
                      showCount > 20
                        ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]'
                        : 'text-[var(--color-muted-foreground)]'
                    )}
                  >
                    {tCommon('all')}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              {rows.map((r, i) => {
                const barWidth = maxValue > 0 ? (r.value / maxValue) * 100 : 0;
                const share =
                  isAdditive && campaignTotal > 0
                    ? ((r.value / campaignTotal) * 100).toFixed(1)
                    : null;

                return (
                  <div
                    key={i}
                    className="group relative overflow-hidden rounded-lg p-3 transition-colors hover:bg-[var(--color-accent)]/50"
                  >
                    {/* Background bar */}
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg opacity-[0.07]"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: config.accent,
                      }}
                    />
                    <div className="relative flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold"
                          style={{
                            backgroundColor: `${config.accent}18`,
                            color: config.accent,
                          }}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={cn(
                            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                            r.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-amber-500'
                          )}
                          title={r.status}
                        />
                        <span className="truncate text-sm text-[var(--color-foreground)]">
                          {r.name}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {share && (
                          <span className="text-[11px] text-[var(--color-muted-foreground)] tabular-nums">
                            {share}%
                          </span>
                        )}
                        <span className="text-sm font-semibold text-[var(--color-foreground)] tabular-nums">
                          {formatMetric(r.value, config.format)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                  {tCommon('noDataAvailable')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      {/* end stale-state wrapper */}
    </SlidePanel>
  );
}
