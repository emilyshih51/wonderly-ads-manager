/**
 * Cost per succeeding contractor — the acquisition economics the Growth Sheet spec
 * asks for: what Wonderly spends on Facebook to land a contractor who then *succeeds*.
 *
 * Spec definition: "succeeding" = ROI ≥ 2× — the contractor's modeled expected
 * contribution (EV_OWED, Wonderly's cut) is at least twice their actual Meta spend —
 * within 60 / 90 days of their deal being **accepted**.
 *
 * Cost basis: for the cohort of contractors accepted in the matured window, the cost is
 * the Facebook acquisition spend over that acceptance window ÷ how many of the cohort
 * succeed. This connects a cohort's acquisition spend to that cohort's success (an honest
 * approximation — Facebook spend is aggregate, not tagged to an individual contractor).
 *
 * The data is young (acceptance events begin mid-2026) and the 2× bar is high, so few or
 * no cohorts clear it yet — hence the low-n guard: below a minimum we show the cohort
 * counts instead of a noisy dollar figure.
 */

/** Counts and acceptance-window bounds from the Snowflake cohort query, per window. */
export interface SucceedingContractors {
  /** Accepted-and-linked contractors whose 60-day window has fully elapsed. */
  matured60: number;
  /** Of matured-60, how many reached ROI ≥ 2× within 60 days of acceptance. */
  succeeding60: number;
  matured90: number;
  succeeding90: number;
  /** Acceptance-date bounds (`YYYY-MM-DD`) of the matured-60 cohort, for the CAC window. */
  cohort60Start: string;
  cohort60End: string;
  cohort90Start: string;
  cohort90End: string;
}

/**
 * Minimum succeeding contractors before we trust a cost-per figure. Below this the
 * denominator is too small to divide into — we surface the cohort counts instead.
 */
export const MIN_SUCCEEDING = 5;

/**
 * Build the value cell for a "Cost per succeeding contractor" row.
 *
 * With enough succeeding contractors it returns the dollar cost (Facebook acquisition
 * spend over the cohort's acceptance window ÷ succeeding contractors). Otherwise it
 * returns a transparent "maturing" string with the counts, so the row is honest about
 * why there's no number yet and fills in automatically as cohorts age.
 *
 * @param cohortFbSpend - Facebook acquisition spend over the cohort's acceptance window
 * @param succeeding - Succeeding contractors in the window
 * @param matured - Contractors whose window has fully elapsed (the cohort size)
 * @returns A dollar amount when the cohort is large enough, else a status string
 */
export function succeedingCostCell(
  cohortFbSpend: number,
  succeeding: number,
  matured: number
): number | string {
  if (succeeding >= MIN_SUCCEEDING) {
    return Math.round(cohortFbSpend / succeeding);
  }

  return `maturing — ${succeeding}/${matured} cohort succeeding (ROI ≥ 2×)`;
}
