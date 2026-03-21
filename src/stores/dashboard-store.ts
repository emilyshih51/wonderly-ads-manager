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

/** A single chart widget configuration. */
export interface ChartWidget {
  id: string;
  metric: ChartMetric;
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

const DEFAULT_WIDGETS: ChartWidget[] = [
  {
    id: 'chart-1',
    metric: 'spend',
    chartType: 'area',
    label: 'Spend',
    color: '#2563eb',
  },
  {
    id: 'chart-2',
    metric: 'results',
    chartType: 'bar',
    label: 'Results',
    color: '#6366f1',
  },
];

interface DashboardState {
  /** Ordered list of chart widgets. */
  widgets: ChartWidget[];
  /** Reorder widgets by providing a new array. */
  setWidgets: (widgets: ChartWidget[]) => void;
  /** Update a single widget's configuration. */
  updateWidget: (id: string, updates: Partial<Omit<ChartWidget, 'id'>>) => void;
  /** Add a new chart widget. */
  addWidget: () => void;
  /** Remove a chart widget. */
  removeWidget: (id: string) => void;
  /** Reset to defaults. */
  resetWidgets: () => void;
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
          const usedMetrics = new Set(s.widgets.map((w) => w.metric));
          const available = (Object.keys(METRIC_OPTIONS) as ChartMetric[]).find(
            (m) => !usedMetrics.has(m)
          );

          if (!available) return s;
          const meta = METRIC_OPTIONS[available];

          return {
            widgets: [
              ...s.widgets,
              {
                id: `chart-${Date.now()}`,
                metric: available,
                chartType: meta.defaultChartType,
                label: meta.label,
                color: meta.defaultColor,
              },
            ],
          };
        }),
      removeWidget: (id) => set((s) => ({ widgets: s.widgets.filter((w) => w.id !== id) })),
      resetWidgets: () => set({ widgets: DEFAULT_WIDGETS }),
    }),
    {
      name: 'wonderly-dashboard-layout',
    }
  )
);
