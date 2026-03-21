'use client';

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import { AreaChart, BarChart, type ChartSeries } from '@/components/data/chart';
import {
  useDashboardStore,
  METRIC_OPTIONS,
  METRIC_COMBOS,
  type ChartMetric,
  type ChartWidget as ChartWidgetConfig,
} from '@/stores/dashboard-store';
import { GripVertical, X, BarChart3, TrendingUp, Plus, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChartWidgetProps {
  widget: ChartWidgetConfig;
  data: Record<string, unknown>[];
  datePreset: string;
}

/**
 * A single draggable chart card with multi-metric comparison support.
 */
export function ChartWidget({ widget, data, datePreset }: ChartWidgetProps) {
  const {
    updateWidget,
    removeWidget,
    addMetricToWidget,
    removeMetricFromWidget,
    applyCombo,
    widgets,
  } = useDashboardStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });
  const [showAddMenu, setShowAddMenu] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const metrics = widget.metrics ?? [{ key: widget.metric, color: widget.color }];
  const Chart = widget.chartType === 'area' ? AreaChart : BarChart;

  // Build series array with per-series format and Y-axis assignment
  const formats = metrics.map((m) => METRIC_OPTIONS[m.key].format);
  const primaryFormat = formats[0];
  const hasMultipleFormats = formats.some((f) => f !== primaryFormat);

  const series: ChartSeries[] = metrics.map((m, i) => {
    const meta = METRIC_OPTIONS[m.key];
    const needsRightAxis = hasMultipleFormats && i > 0 && meta.format !== primaryFormat;

    return {
      key: m.key,
      label: meta.label,
      color: m.color,
      format: meta.format,
      yAxisId: needsRightAxis ? 'right' : 'left',
    };
  });

  const rightFormat = hasMultipleFormats ? formats.find((f) => f !== primaryFormat) : undefined;

  // Metrics available to add (not already in this widget)
  const usedKeys = new Set(metrics.map((m) => m.key));
  const availableMetrics = (Object.keys(METRIC_OPTIONS) as ChartMetric[]).filter(
    (k) => !usedKeys.has(k)
  );

  const handlePrimaryChange = (metric: ChartMetric) => {
    const meta = METRIC_OPTIONS[metric];

    updateWidget(widget.id, {
      metric,
      metrics: [{ key: metric, color: meta.defaultColor }],
      label: meta.label,
      color: meta.defaultColor,
      chartType: meta.defaultChartType,
    });
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'z-50 opacity-75')}>
      <Card className="relative">
        {/* Drag handle */}
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
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Metric chips */}
              {metrics.map((m) => (
                <button
                  key={m.key}
                  className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]"
                  onClick={() => {
                    if (metrics.length === 1) {
                      // Single metric — cycle to next
                      const allKeys = Object.keys(METRIC_OPTIONS) as ChartMetric[];
                      const idx = allKeys.indexOf(m.key);

                      handlePrimaryChange(allKeys[(idx + 1) % allKeys.length]);
                    }
                  }}
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
                  <span>{METRIC_OPTIONS[m.key].label}</span>
                  {metrics.length > 1 && (
                    <X
                      className="h-3 w-3 text-[var(--color-muted-foreground)] hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMetricFromWidget(widget.id, m.key);
                      }}
                    />
                  )}
                </button>
              ))}

              {/* Add metric button */}
              {metrics.length < 3 && (
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    <Plus className="h-3 w-3" />
                    <span className="hidden sm:inline">Add</span>
                  </button>

                  {showAddMenu && (
                    <div className="absolute top-full left-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-xl">
                      {/* Quick combos */}
                      <div className="border-b border-[var(--color-border)] p-2">
                        <p className="mb-1 px-1 text-[10px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
                          Presets
                        </p>
                        {METRIC_COMBOS.filter((c) => c.metrics.includes(metrics[0].key))
                          .slice(0, 4)
                          .map((combo) => (
                            <button
                              key={combo.label}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
                              onClick={() => {
                                applyCombo(widget.id, combo.metrics);
                                setShowAddMenu(false);
                              }}
                            >
                              <Layers className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                              {combo.label}
                            </button>
                          ))}
                      </div>

                      {/* Individual metrics */}
                      <div className="max-h-48 overflow-y-auto p-2">
                        <p className="mb-1 px-1 text-[10px] font-medium tracking-wide text-[var(--color-muted-foreground)] uppercase">
                          Add metric
                        </p>
                        {availableMetrics.map((key) => {
                          const meta = METRIC_OPTIONS[key];

                          return (
                            <button
                              key={key}
                              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
                              onClick={() => {
                                addMetricToWidget(widget.id, key);
                                setShowAddMenu(false);
                              }}
                            >
                              <div
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: meta.defaultColor }}
                              />
                              {meta.label}
                              <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">
                                {meta.format}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
            series={series}
            format={primaryFormat}
            rightFormat={rightFormat}
            height={240}
          />
        </CardContent>
      </Card>

      {/* Click-outside to close add menu */}
      {showAddMenu && <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />}
    </div>
  );
}
