import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Available metrics that can be displayed in dashboard charts. */
export type ChartMetric =
  | 'spend'
  | 'impressions'
  | 'clicks'
  | 'ctr'
  | 'cpm'
  | 'cpc'
  | 'results'
  | 'cpr'
  | 'reach';

/** Chart type options. */
export type ChartType = 'area' | 'bar';

/** Format type for chart values. */
export type ChartFormat = 'currency' | 'percent' | 'number';

/** A single metric in a chart widget. */
export interface WidgetMetric {
  key: ChartMetric;
  color: string;
}

/** A single chart widget configuration. */
export interface ChartWidget {
  id: string;
  /** Primary metric (first in the list). */
  metric: ChartMetric;
  /** All metrics shown in this chart (includes the primary). */
  metrics: WidgetMetric[];
  chartType: ChartType;
  label: string;
  color: string;
}

/** Metadata for each available metric. */
export const METRIC_OPTIONS: Record<
  ChartMetric,
  { labelKey: string; format: ChartFormat; defaultColor: string; defaultChartType: ChartType }
> = {
  spend: {
    labelKey: 'spend',
    format: 'currency',
    defaultColor: '#2563eb',
    defaultChartType: 'area',
  },
  impressions: {
    labelKey: 'impressions',
    format: 'number',
    defaultColor: '#8b5cf6',
    defaultChartType: 'bar',
  },
  clicks: {
    labelKey: 'clicks',
    format: 'number',
    defaultColor: '#f59e0b',
    defaultChartType: 'bar',
  },
  ctr: { labelKey: 'ctr', format: 'percent', defaultColor: '#10b981', defaultChartType: 'area' },
  cpm: { labelKey: 'cpm', format: 'currency', defaultColor: '#06b6d4', defaultChartType: 'area' },
  cpc: { labelKey: 'cpc', format: 'currency', defaultColor: '#ef4444', defaultChartType: 'area' },
  results: {
    labelKey: 'results',
    format: 'number',
    defaultColor: '#6366f1',
    defaultChartType: 'bar',
  },
  cpr: {
    labelKey: 'costPerResult',
    format: 'currency',
    defaultColor: '#ec4899',
    defaultChartType: 'area',
  },
  reach: { labelKey: 'reach', format: 'number', defaultColor: '#14b8a6', defaultChartType: 'bar' },
};

/**
 * Pre-defined metric combinations that make analytical sense.
 * Each group contains metrics that are meaningful when compared together.
 */
export const METRIC_COMBOS: { labelKey: string; metrics: ChartMetric[] }[] = [
  { labelKey: 'spendVsResults', metrics: ['spend', 'results'] },
  { labelKey: 'spendVsCpa', metrics: ['spend', 'cpr'] },
  { labelKey: 'clicksVsCtr', metrics: ['clicks', 'ctr'] },
  { labelKey: 'spendVsClicks', metrics: ['spend', 'clicks'] },
  { labelKey: 'impressionsVsReach', metrics: ['impressions', 'reach'] },
  { labelKey: 'impressionsVsClicks', metrics: ['impressions', 'clicks'] },
  { labelKey: 'cpcVsCtr', metrics: ['cpc', 'ctr'] },
  { labelKey: 'cpmVsCpc', metrics: ['cpm', 'cpc'] },
  { labelKey: 'resultsVsCpa', metrics: ['results', 'cpr'] },
  { labelKey: 'spendVsCpm', metrics: ['spend', 'cpm'] },
  { labelKey: 'spendResultsCpa', metrics: ['spend', 'results', 'cpr'] },
  { labelKey: 'clicksCtrCpc', metrics: ['clicks', 'ctr', 'cpc'] },
];

function makeWidget(metric: ChartMetric, id?: string): ChartWidget {
  const meta = METRIC_OPTIONS[metric];

  return {
    id: id ?? `chart-${Date.now()}`,
    metric,
    metrics: [{ key: metric, color: meta.defaultColor }],
    chartType: meta.defaultChartType,
    label: meta.labelKey,
    color: meta.defaultColor,
  };
}

const DEFAULT_WIDGETS: ChartWidget[] = [
  makeWidget('spend', 'chart-1'),
  makeWidget('results', 'chart-2'),
];

interface DashboardState {
  widgets: ChartWidget[];
  setWidgets: (widgets: ChartWidget[]) => void;
  updateWidget: (id: string, updates: Partial<Omit<ChartWidget, 'id'>>) => void;
  addWidget: () => void;
  removeWidget: (id: string) => void;
  resetWidgets: () => void;
  /** Add a metric to an existing widget for multi-series comparison. */
  addMetricToWidget: (widgetId: string, metric: ChartMetric) => void;
  /** Remove a metric from a widget (cannot remove the last one). */
  removeMetricFromWidget: (widgetId: string, metric: ChartMetric) => void;
  /** Apply a preset combination to a widget. */
  applyCombo: (widgetId: string, metrics: ChartMetric[]) => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      widgets: DEFAULT_WIDGETS,
      setWidgets: (widgets) => set({ widgets }),
      updateWidget: (id, updates) =>
        set((s) => ({
          widgets: s.widgets.map((w) => (w.id === id ? { ...w, ...updates } : w)),
        })),
      addWidget: () =>
        set((s) => {
          const usedMetrics = new Set(s.widgets.flatMap((w) => w.metrics.map((m) => m.key)));
          const available = (Object.keys(METRIC_OPTIONS) as ChartMetric[]).find(
            (m) => !usedMetrics.has(m)
          );

          if (!available) return s;

          return { widgets: [...s.widgets, makeWidget(available)] };
        }),
      removeWidget: (id) => set((s) => ({ widgets: s.widgets.filter((w) => w.id !== id) })),
      resetWidgets: () => set({ widgets: DEFAULT_WIDGETS }),

      addMetricToWidget: (widgetId, metric) =>
        set((s) => ({
          widgets: s.widgets.map((w) => {
            if (w.id !== widgetId) return w;
            if (w.metrics.some((m) => m.key === metric)) return w; // already added
            if (w.metrics.length >= 3) return w; // max 3 metrics per chart

            const meta = METRIC_OPTIONS[metric];

            return {
              ...w,
              metrics: [...w.metrics, { key: metric, color: meta.defaultColor }],
              label: w.metrics.length === 0 ? meta.labelKey : `${w.label} + ${meta.labelKey}`,
            };
          }),
        })),

      removeMetricFromWidget: (widgetId, metric) =>
        set((s) => ({
          widgets: s.widgets.map((w) => {
            if (w.id !== widgetId) return w;
            if (w.metrics.length <= 1) return w; // can't remove last metric

            const newMetrics = w.metrics.filter((m) => m.key !== metric);
            const primary = newMetrics[0];
            const primaryMeta = METRIC_OPTIONS[primary.key];

            return {
              ...w,
              metric: primary.key,
              metrics: newMetrics,
              color: primary.color,
              label: newMetrics.map((m) => METRIC_OPTIONS[m.key].labelKey).join(' + '),
              chartType: primaryMeta.defaultChartType,
            };
          }),
        })),

      applyCombo: (widgetId, metrics) =>
        set((s) => ({
          widgets: s.widgets.map((w) => {
            if (w.id !== widgetId) return w;

            const widgetMetrics = metrics.map((key) => ({
              key,
              color: METRIC_OPTIONS[key].defaultColor,
            }));
            const primary = METRIC_OPTIONS[metrics[0]];

            return {
              ...w,
              metric: metrics[0],
              metrics: widgetMetrics,
              label: metrics.map((m) => METRIC_OPTIONS[m].labelKey).join(' + '),
              color: primary.defaultColor,
              chartType: 'area',
            };
          }),
        })),
    }),
    {
      name: 'wonderly-dashboard-layout',
    }
  )
);
