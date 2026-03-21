'use client';

import { type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  accent?: string;
  detail?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Compact stat card — reusable across pages for summary metrics.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  accent = '#2563eb',
  detail,
  onClick,
  className,
}: StatCardProps) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        'relative overflow-hidden',
        onClick &&
          'cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        className
      )}
    >
      <div
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: accent }}
      />
      <CardContent className="p-4 pl-3.5 md:p-5 md:pl-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase md:text-xs">
              {label}
            </p>
            <p className="mt-1 text-xl font-bold text-[var(--color-foreground)] tabular-nums md:text-2xl">
              {value}
            </p>
            {detail && (
              <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">{detail}</p>
            )}
          </div>
          {Icon && (
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg md:h-9 md:w-9"
              style={{ backgroundColor: `${accent}18` }}
            >
              <Icon className="h-4 w-4 md:h-4.5 md:w-4.5" style={{ color: accent }} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
