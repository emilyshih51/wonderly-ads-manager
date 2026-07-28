/**
 * Cost per succeeding contractor — the acquisition economics the Growth Sheet spec
 * asks for: what Wonderly spends on Facebook to land a contractor who then *succeeds*.
 *
 * "Succeeding" = a contractor whose cumulative servicing P&L (PNL_USD in the customer
 * value view) turns positive within 60 / 90 days of going live (their ad-start date).
 *
 * The contractor → customer-value link lives entirely in prod (BASE__TEAMS is 1:1 with
 * the value view), so this no longer needs the old dev-CRM bridge. But the value data
 * only began in 2026 and P&L matures slowly, so few cohorts have 60/90 days behind them
 * — hence the low-n guard: below a minimum of succeeding contractors we show the raw
 * cohort counts instead of a noisy dollar figure.
 */

/** Counts from the Snowflake cohort query, per maturation window. */
export interface SucceedingContractors {
  /** Teams whose ad-start is ≥60 days ago (so a 60-day P&L window has fully elapsed). */
  matured60: number;
  /** Of the matured-60 teams, how many reached cumulative PNL > 0 within 60 days. */
  succeeding60: number;
  matured90: number;
  succeeding90: number;
}

/**
 * Minimum succeeding contractors before we trust a cost-per figure. Below this the
 * denominator is too small to divide into — we surface the cohort counts instead.
 */
export const MIN_SUCCEEDING = 5;

/**
 * Build the value cell for a "Cost per succeeding contractor" row.
 *
 * With enough matured, succeeding contractors it returns the dollar cost (cumulative
 * Facebook acquisition spend ÷ succeeding contractors). Otherwise it returns a
 * transparent "maturing" string with the current counts, so the row is honest about
 * why there's no number yet and fills in automatically as cohorts age.
 *
 * @param cumulativeFbSpend - Total Wonderly Facebook acquisition spend to date
 * @param succeeding - Succeeding contractors in the window
 * @param matured - Contractors whose window has fully elapsed (the cohort size)
 * @returns A dollar amount when the cohort is large enough, else a status string
 */
export function succeedingCostCell(
  cumulativeFbSpend: number,
  succeeding: number,
  matured: number
): number | string {
  if (succeeding >= MIN_SUCCEEDING) {
    return Math.round(cumulativeFbSpend / succeeding);
  }

  return `maturing — ${succeeding}/${matured} cohort succeeding`;
}
