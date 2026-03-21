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
  accent: string;
  trend?: TrendInfo | null;
  trendLoading?: boolean;
  sparklineData?: number[];
  onClick?: () => void;
  isPositiveTrend?: boolean;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
  trend,
  trendLoading,
  sparklineData,
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
        'relative overflow-hidden transition-all duration-200',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md'
      )}
    >
      {/* Accent bar */}
      <div
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: accent }}
      />

      <CardContent className="p-4 pl-3.5 md:p-5 md:pl-4">
        <div className="mb-2 flex items-center justify-between md:mb-3">
          <span className="text-[10px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase md:text-xs">
            {label}
          </span>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg md:h-8 md:w-8"
            style={{ backgroundColor: `${accent}18` }}
          >
            <Icon className="h-3.5 w-3.5 md:h-4 md:w-4" style={{ color: accent }} />
          </div>
        </div>

        <p className="mb-1.5 text-xl font-bold tracking-tight text-[var(--color-foreground)] md:mb-2 md:text-2xl">
          {value}
        </p>

        <div className="flex items-center justify-between">
          {trendLoading ? (
            <Skeleton className="h-5 w-14 rounded-full" />
          ) : trend && trend.direction !== 'flat' ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium md:text-xs',
                isGood && 'text-emerald-600 dark:text-emerald-400',
                isBad && 'text-red-500 dark:text-red-400',
                !isGood && !isBad && 'text-[var(--color-muted-foreground)]'
              )}
            >
              {trend.direction === 'up' ? (
                <ArrowUp className="h-2.5 w-2.5 md:h-3 md:w-3" />
              ) : (
                <ArrowDown className="h-2.5 w-2.5 md:h-3 md:w-3" />
              )}
              {trend.pct}%
            </span>
          ) : trend?.direction === 'flat' ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)] md:text-xs">
              <Minus className="h-2.5 w-2.5 md:h-3 md:w-3" />
              0%
            </span>
          ) : (
            <span />
          )}

          {sparklineData && sparklineData.length > 1 && (
            <div className="hidden opacity-50 sm:block">
              <Sparkline data={sparklineData} color={accent} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
