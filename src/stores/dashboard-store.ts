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
  { label: string; format: ChartFormat; defaultColor: string; defaultChartType: ChartType }
> = {
  spend: { label: 'Spend', format: 'currency', defaultColor: '#2563eb', defaultChartType: 'area' },
  impressions: {
    label: 'Impressions',
    format: 'number',
    defaultColor: '#8b5cf6',
    defaultChartType: 'bar',
  },
  clicks: { label: 'Clicks', format: 'number', defaultColor: '#f59e0b', defaultChartType: 'bar' },
  ctr: { label: 'CTR', format: 'percent', defaultColor: '#10b981', defaultChartType: 'area' },
  cpm: { label: 'CPM', format: 'currency', defaultColor: '#06b6d4', defaultChartType: 'area' },
  cpc: { label: 'CPC', format: 'currency', defaultColor: '#ef4444', defaultChartType: 'area' },
  results: {
    label: 'Results',
    format: 'number',
    defaultColor: '#6366f1',
    defaultChartType: 'bar',
  },
  cpr: {
    label: 'Cost per Result',
    format: 'currency',
    defaultColor: '#ec4899',
    defaultChartType: 'area',
  },
  reach: { label: 'Reach', format: 'number', defaultColor: '#14b8a6', defaultChartType: 'bar' },
};

/**
 * Pre-defined metric combinations that make analytical sense.
 * Each group contains metrics that are meaningful when compared together.
 */
export const METRIC_COMBOS: { label: string; metrics: ChartMetric[] }[] = [
  { label: 'Spend vs Results', metrics: ['spend', 'results'] },
  { label: 'Spend vs CPA', metrics: ['spend', 'cpr'] },
  { label: 'Clicks vs CTR', metrics: ['clicks', 'ctr'] },
  { label: 'Spend vs Clicks', metrics: ['spend', 'clicks'] },
  { label: 'Impressions vs Reach', metrics: ['impressions', 'reach'] },
  { label: 'Impressions vs Clicks', metrics: ['impressions', 'clicks'] },
  { label: 'CPC vs CTR', metrics: ['cpc', 'ctr'] },
  { label: 'CPM vs CPC', metrics: ['cpm', 'cpc'] },
  { label: 'Results vs CPA', metrics: ['results', 'cpr'] },
  { label: 'Spend vs CPM', metrics: ['spend', 'cpm'] },
  { label: 'Spend + Results + CPA', metrics: ['spend', 'results', 'cpr'] },
  { label: 'Clicks + CTR + CPC', metrics: ['clicks', 'ctr', 'cpc'] },
];

function makeWidget(metric: ChartMetric, id?: string): ChartWidget {
  const meta = METRIC_OPTIONS[metric];

  return {
    id: id ?? `chart-${Date.now()}`,
    metric,
    metrics: [{ key: metric, color: meta.defaultColor }],
    chartType: meta.defaultChartType,
    label: meta.label,
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
              label: w.metrics.length === 0 ? meta.label : `${w.label} + ${meta.label}`,
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
              label: newMetrics.map((m) => METRIC_OPTIONS[m.key].label).join(' + '),
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
              label: metrics.map((m) => METRIC_OPTIONS[m].label).join(' + '),
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
