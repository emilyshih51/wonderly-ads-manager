'use client';

import { SlidePanel } from '@/components/data/slide-panel';
import { AreaChart } from '@/components/data/chart';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils';
import type { CampaignRow } from '@/lib/queries/meta/use-campaigns';

type MetricKey = 'spend' | 'results' | 'ctr' | 'cpm' | 'cpc' | 'cpr';

const METRIC_CONFIG: Record<
  MetricKey,
  { label: string; format: 'currency' | 'percent' | 'number'; color: string }
> = {
  spend: { label: 'Spend', format: 'currency', color: '#2563eb' },
  results: { label: 'Results', format: 'number', color: '#10b981' },
  ctr: { label: 'CTR', format: 'percent', color: '#f59e0b' },
  cpm: { label: 'CPM', format: 'currency', color: '#8b5cf6' },
  cpc: { label: 'CPC', format: 'currency', color: '#06b6d4' },
  cpr: { label: 'Cost per Result', format: 'currency', color: '#ef4444' },
};

function getMetricValue(campaign: CampaignRow, metric: MetricKey): number {
  const ins = campaign.insights;

  if (!ins) return 0;

  switch (metric) {
    case 'spend':
      return parseFloat(ins.spend ?? '0');

    case 'results': {
      const conv = ins.actions?.find(
        (a) => a.action_type === 'offsite_conversion.fb_pixel_purchase'
      );

      return conv ? parseInt(conv.value, 10) : 0;
    }

    case 'ctr':
      return parseFloat(ins.ctr ?? '0');
    case 'cpm':
      return parseFloat(ins.cpm ?? '0');
    case 'cpc':
      return parseFloat(ins.cpc ?? '0');

    case 'cpr': {
      const spend = parseFloat(ins.spend ?? '0');
      const conv = ins.actions?.find(
        (a) => a.action_type === 'offsite_conversion.fb_pixel_purchase'
      );
      const results = conv ? parseInt(conv.value, 10) : 0;

      return results > 0 ? spend / results : 0;
    }
  }
}

function formatMetric(value: number, format: 'currency' | 'percent' | 'number'): string {
  if (format === 'currency') return formatCurrency(value);
  if (format === 'percent') return formatPercent(value);

  return formatNumber(value);
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
 * @param campaigns - Current period campaign data
 * @param open - Whether the panel is visible
 * @param onClose - Close handler
 */
export function StatDetailPanel({ metric, campaigns, open, onClose }: StatDetailPanelProps) {
  const config = METRIC_CONFIG[metric];

  const rows = campaigns
    .map((c) => ({ name: c.name, value: getMetricValue(c, metric) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  // Build sparkline-style data for the chart (campaign values as a distribution)
  const chartData = rows.map((r) => ({
    name: r.name.length > 20 ? r.name.slice(0, 20) + '…' : r.name,
    [metric]: r.value,
  }));

  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <SlidePanel
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={config.label}
      description={`Breakdown across ${campaigns.length} campaigns`}
    >
      {/* Summary */}
      <div className="mb-6 rounded-xl bg-[var(--color-muted)] p-4">
        <p className="text-xs text-[var(--color-muted-foreground)]">Total</p>
        <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
          {formatMetric(total, config.format)}
        </p>
      </div>

      {/* Mini chart */}
      {chartData.length > 1 && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-[var(--color-muted-foreground)]">
            Distribution
          </p>
          <AreaChart
            data={chartData}
            xKey="name"
            series={[{ key: metric, label: config.label, color: config.color }]}
            format={config.format}
            height={160}
          />
        </div>
      )}

      {/* Campaign breakdown table */}
      <div>
        <p className="mb-3 text-xs font-medium text-[var(--color-muted-foreground)]">By Campaign</p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-4 rounded-lg p-2 hover:bg-[var(--color-muted)]"
            >
              <span className="flex-1 truncate text-sm text-[var(--color-foreground)]">
                {r.name}
              </span>
              <span className="shrink-0 text-sm font-medium text-[var(--color-foreground)]">
                {formatMetric(r.value, config.format)}
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--color-muted-foreground)]">
              No data available
            </p>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}
