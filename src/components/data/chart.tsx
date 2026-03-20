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

/** A single data series definition. */
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
  if (format === 'percent') return `${value.toFixed(1)}%`;

  return value.toLocaleString();
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }>;
  label?: string;
  format?: FormatType;
}

function ChartTooltip({ active, payload, label, format = 'number' }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-[var(--color-muted-foreground)]">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-semibold" style={{ color: entry.color }}>
          {entry.name}: {formatValue(entry.value ?? 0, format)}
        </p>
      ))}
    </div>
  );
}

const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

/**
 * Themed AreaChart wrapper — pre-styles grid, axes, and tooltip with CSS vars.
 *
 * @param data - Array of data objects
 * @param xKey - Key for the x-axis values
 * @param series - Data series to render
 * @param format - Value format for the y-axis and tooltip
 * @param height - Chart height in px (default 280)
 */
export function AreaChart({ data, xKey, series, format = 'number', height = 280 }: BaseChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];

            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
        <Tooltip content={<ChartTooltip format={format} />} />
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
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          );
        })}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Themed BarChart wrapper.
 *
 * @param data - Array of data objects
 * @param xKey - Key for the x-axis values
 * @param series - Data series to render
 * @param format - Value format for the y-axis and tooltip
 * @param height - Chart height in px (default 280)
 */
export function BarChart({ data, xKey, series, format = 'number', height = 280 }: BaseChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
        <Tooltip content={<ChartTooltip format={format} />} />
        {series.map((s, i) => {
          const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];

          return (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[3, 3, 0, 0]} />
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
 * Used inside metric cards as a decorative trend indicator.
 *
 * @param data - Array of numeric values
 * @param color - Line color (default blue)
 * @param width - Chart width in px (default 80)
 * @param height - Chart height in px (default 32)
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
