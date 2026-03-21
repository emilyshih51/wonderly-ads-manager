'use client';

import * as React from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

type DataRecord = Record<string, unknown>;

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
}

type FormatType = 'currency' | 'percent' | 'number';

interface BaseChartProps {
  data: DataRecord[];
  xKey: string;
  series: ChartSeries[];
  format?: FormatType;
  height?: number;
  className?: string;
}

function formatValue(value: number, format: FormatType): string {
  if (format === 'currency') return formatCurrency(value);
  if (format === 'percent') return `${value.toFixed(2)}%`;

  return value.toLocaleString();
}

/** Maps metric keys to their format type for contextual tooltip rows. */
const METRIC_FORMATS: Record<string, FormatType> = {
  spend: 'currency',
  impressions: 'number',
  clicks: 'number',
  ctr: 'percent',
  cpm: 'currency',
  cpc: 'currency',
  results: 'number',
  cpr: 'currency',
  reach: 'number',
};

/** Maps metric keys to display labels. */
const METRIC_LABELS: Record<string, string> = {
  spend: 'Spend',
  impressions: 'Impressions',
  clicks: 'Clicks',
  ctr: 'CTR',
  cpm: 'CPM',
  cpc: 'CPC',
  results: 'Results',
  cpr: 'Cost/Result',
  reach: 'Reach',
};

/** Related metrics to show alongside the primary one. */
const RELATED_METRICS: Record<string, string[]> = {
  spend: ['impressions', 'clicks', 'results'],
  impressions: ['spend', 'cpm', 'reach'],
  clicks: ['spend', 'ctr', 'cpc'],
  ctr: ['clicks', 'impressions'],
  cpm: ['spend', 'impressions'],
  cpc: ['spend', 'clicks'],
  results: ['spend', 'cpr'],
  cpr: ['spend', 'results'],
  reach: ['impressions', 'spend'],
};

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    name?: string;
    value?: number;
    color?: string;
    payload?: DataRecord;
  }>;
  label?: string;
  format?: FormatType;
  primaryKey?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  format = 'number',
  primaryKey,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const row = entry.payload;
  const related = primaryKey ? (RELATED_METRICS[primaryKey] ?? []) : [];

  return (
    <div className="min-w-[140px] rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-lg">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
        {label}
      </p>
      {/* Primary value */}
      <p className="text-lg font-bold tabular-nums" style={{ color: entry.color }}>
        {formatValue(entry.value ?? 0, format)}
      </p>
      <p className="mb-2 text-[11px] text-[var(--color-muted-foreground)]">{entry.name}</p>

      {/* Related metrics */}
      {related.length > 0 && row && (
        <div className="space-y-1 border-t border-[var(--color-border)] pt-2">
          {related.map((key) => {
            const val = row[key];

            if (val == null) return null;
            const fmt = METRIC_FORMATS[key] ?? 'number';

            return (
              <div key={key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-[var(--color-muted-foreground)]">
                  {METRIC_LABELS[key] ?? key}
                </span>
                <span className="font-medium text-[var(--color-foreground)] tabular-nums">
                  {formatValue(Number(val), fmt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

/**
 * Themed AreaChart wrapper.
 */
export function AreaChart({ data, xKey, series, format = 'number', height = 280 }: BaseChartProps) {
  const primaryKey = series[0]?.key;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];

            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          strokeOpacity={0.5}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatValue(v, format)}
          width={format === 'currency' ? 70 : 40}
        />
        <Tooltip
          content={<ChartTooltip format={format} primaryKey={primaryKey} />}
          cursor={{
            stroke: 'var(--color-muted-foreground)',
            strokeWidth: 1,
            strokeDasharray: '4 4',
          }}
        />
        {series.map((s, i) => {
          const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];

          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: 'var(--color-card)',
                fill: color,
              }}
            />
          );
        })}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Themed BarChart wrapper.
 */
export function BarChart({ data, xKey, series, format = 'number', height = 280 }: BaseChartProps) {
  const primaryKey = series[0]?.key;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          strokeOpacity={0.5}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatValue(v, format)}
          width={format === 'currency' ? 70 : 40}
        />
        <Tooltip
          content={<ChartTooltip format={format} primaryKey={primaryKey} />}
          cursor={{ fill: 'var(--color-accent)', opacity: 0.5 }}
        />
        {series.map((s, i) => {
          const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];

          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={color}
              radius={[4, 4, 0, 0]}
              fillOpacity={0.85}
              activeBar={{ fillOpacity: 1, stroke: color, strokeWidth: 1 }}
            />
          );
        })}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

/**
 * Inline sparkline — minimal line chart with no axes or labels.
 */
export function Sparkline({ data, color = '#2563eb', width = 80, height = 32 }: SparklineProps) {
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
