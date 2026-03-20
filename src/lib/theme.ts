/**
 * Theme utilities for prior-period trend calculations.
 */

/** Date range returned for prior period comparisons. */
export interface DateRange {
  since: string;
  until: string;
}

/** Trend direction and percentage change between two periods. */
export interface TrendResult {
  pct: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * Returns ISO date strings for the prior period matching the given date preset.
 * Returns null for presets where comparison doesn't make sense.
 *
 * @param datePreset - Meta date preset string (e.g. 'last_7d', 'last_30d')
 * @returns Prior period date range, or null if not applicable
 */
export function getPriorPeriodDates(datePreset: string): DateRange | null {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const shift = (days: number) => {
    const d = new Date(today);

    d.setDate(d.getDate() - days);

    return d;
  };

  switch (datePreset) {
    case 'last_7d': {
      // Prior: today-14 to today-8
      return { since: fmt(shift(14)), until: fmt(shift(8)) };
    }

    case 'last_14d': {
      return { since: fmt(shift(28)), until: fmt(shift(15)) };
    }

    case 'last_30d': {
      return { since: fmt(shift(60)), until: fmt(shift(31)) };
    }

    case 'last_90d': {
      return { since: fmt(shift(180)), until: fmt(shift(91)) };
    }

    case 'this_month': {
      // Prior: same span last month
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const firstOfPriorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastOfPriorMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      const dayOfMonth = today.getDate();
      const priorUntil = new Date(firstOfPriorMonth);

      priorUntil.setDate(Math.min(dayOfMonth, lastOfPriorMonth.getDate()));
      void firstOfMonth; // used to compute priorUntil span

      return { since: fmt(firstOfPriorMonth), until: fmt(priorUntil) };
    }

    case 'last_month': {
      const firstOfPriorMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const lastOfPriorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 0);

      return { since: fmt(firstOfPriorMonth), until: fmt(lastOfPriorMonth) };
    }

    // No meaningful prior period for single-day presets
    case 'today':
    case 'yesterday':
      return null;
    default:
      return null;
  }
}

/**
 * Computes the percentage change and direction between two values.
 *
 * @param current - Current period value
 * @param prior - Prior period value
 * @returns Trend with percentage and direction
 */
export function formatTrend(current: number, prior: number): TrendResult {
  if (prior === 0) {
    return { pct: 0, direction: 'flat' };
  }

  const pct = Math.round(((current - prior) / Math.abs(prior)) * 100);

  return {
    pct: Math.abs(pct),
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat',
  };
}
