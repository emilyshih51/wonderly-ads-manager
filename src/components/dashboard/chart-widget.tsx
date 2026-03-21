'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/dropdown';
import { AreaChart, BarChart } from '@/components/data/chart';
import {
  useDashboardStore,
  METRIC_OPTIONS,
  type ChartMetric,
  type ChartWidget as ChartWidgetConfig,
} from '@/stores/dashboard-store';
import { GripVertical, X, BarChart3, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChartWidgetProps {
  widget: ChartWidgetConfig;
  data: Record<string, unknown>[];
  datePreset: string;
}

const metricOptions = (Object.keys(METRIC_OPTIONS) as ChartMetric[]).map((key) => ({
  label: METRIC_OPTIONS[key].label,
  value: key,
}));

/**
 * A single draggable chart card with configurable metric and chart type.
 */
export function ChartWidget({ widget, data, datePreset }: ChartWidgetProps) {
  const { updateWidget, removeWidget, widgets } = useDashboardStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const meta = METRIC_OPTIONS[widget.metric];
  const Chart = widget.chartType === 'area' ? AreaChart : BarChart;

  const handleMetricChange = (value: string) => {
    const metric = value as ChartMetric;
    const newMeta = METRIC_OPTIONS[metric];

    updateWidget(widget.id, {
      metric,
      label: newMeta.label,
      color: newMeta.defaultColor,
      chartType: newMeta.defaultChartType,
    });
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-50 opacity-75')}>
      <Card className="relative">
        {/* Drag handle — spans the top edge of the card */}
        <div
          {...attributes}
          {...listeners}
          className="flex cursor-grab items-center justify-center py-1.5 text-[var(--color-muted-foreground)] opacity-40 transition-opacity hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 rotate-90" />
        </div>

        <CardContent className="px-4 pt-0 pb-4 md:px-5">
          {/* Controls row */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Select
                value={widget.metric}
                onChange={handleMetricChange}
                options={metricOptions}
                className="h-8 w-32 text-sm font-medium md:w-36"
              />
              <span className="text-[11px] text-[var(--color-muted-foreground)]">
                {datePreset.replace(/_/g, ' ')}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <div className="flex overflow-hidden rounded-md border border-[var(--color-border)]">
                <button
                  onClick={() => updateWidget(widget.id, { chartType: 'area' })}
                  className={cn(
                    'p-1.5 transition-colors',
                    widget.chartType === 'area'
                      ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]'
                  )}
                  aria-label="Area chart"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => updateWidget(widget.id, { chartType: 'bar' })}
                  className={cn(
                    'p-1.5 transition-colors',
                    widget.chartType === 'bar'
                      ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]'
                  )}
                  aria-label="Bar chart"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                </button>
              </div>
              {widgets.length > 1 && (
                <button
                  onClick={() => removeWidget(widget.id)}
                  className="rounded-md p-1.5 text-[var(--color-muted-foreground)] transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950 dark:hover:text-red-400"
                  aria-label="Remove chart"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Chart */}
          <Chart
            data={data}
            xKey="date"
            series={[{ key: widget.metric, label: widget.label, color: widget.color }]}
            format={meta.format}
            height={240}
          />
        </CardContent>
      </Card>
    </div>
  );
}
