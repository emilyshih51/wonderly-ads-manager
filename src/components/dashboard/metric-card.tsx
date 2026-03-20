'use client';

import { type LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/data/chart';
import { cn } from '@/lib/utils';

interface TrendInfo {
  pct: number;
  direction: 'up' | 'down' | 'flat';
}

export interface MetricCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  trend?: TrendInfo | null;
  trendLoading?: boolean;
  sparklineData?: number[];
  sparklineColor?: string;
  onClick?: () => void;
  isPositiveTrend?: boolean;
}

/**
 * Stat card used on the dashboard.
 * Shows a metric value with an optional sparkline, trend badge, and click handler.
 *
 * @param label - Metric label text
 * @param value - Formatted metric value
 * @param icon - Lucide icon component
 * @param color - Icon text color class
 * @param bg - Icon background color class
 * @param trend - Trend data (pct change + direction)
 * @param trendLoading - Shows skeleton badge while prior period loads
 * @param sparklineData - Array of numbers for the sparkline
 * @param sparklineColor - Sparkline line color (defaults to blue)
 * @param onClick - Click handler — enables hover effect and cursor-pointer
 * @param isPositiveTrend - Whether 'up' direction is good (default true)
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
  trend,
  trendLoading,
  sparklineData,
  sparklineColor,
  onClick,
  isPositiveTrend = true,
}: MetricCardProps) {
  const isGood =
    trend &&
    ((isPositiveTrend && trend.direction === 'up') ||
      (!isPositiveTrend && trend.direction === 'down'));

  const isBad =
    trend &&
    ((isPositiveTrend && trend.direction === 'down') ||
      (!isPositiveTrend && trend.direction === 'up'));

  return (
    <Card
      onClick={onClick}
      className={cn(
        'transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md'
      )}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--color-muted-foreground)]">{label}</span>
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', bg)}>
            <Icon className={cn('h-4 w-4', color)} />
          </div>
        </div>

        <p className="mb-2 text-2xl font-bold text-[var(--color-foreground)]">{value}</p>

        <div className="flex items-center justify-between">
          {/* Trend badge */}
          {trendLoading ? (
            <Skeleton className="h-5 w-16 rounded-full" />
          ) : trend && trend.direction !== 'flat' ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium',
                isGood && 'bg-emerald-100 text-emerald-700',
                isBad && 'bg-red-100 text-red-700',
                !isGood && !isBad && 'bg-[var(--color-accent)] text-[var(--color-muted-foreground)]'
              )}
            >
              {trend.direction === 'up' ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {trend.pct}%
            </span>
          ) : trend?.direction === 'flat' ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted-foreground)]">
              <Minus className="h-3 w-3" />
              0%
            </span>
          ) : (
            <span />
          )}

          {/* Sparkline */}
          {sparklineData && sparklineData.length > 1 && (
            <div className="opacity-60">
              <Sparkline data={sparklineData} color={sparklineColor ?? '#2563eb'} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
