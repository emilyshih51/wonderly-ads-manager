/**
 * Customer P&L — the daily aggregate of how Wonderly's customer base is doing.
 *
 * A different question from the marketing tab. The marketing tab is what Wonderly
 * spends to *acquire* contractors (FB_SPEND). This is Wonderly's servicing economics
 * across its customers: EV take (Wonderly's cut of the value it generates for a
 * customer) minus the ad spend it manages *on that customer's behalf* = PnL.
 *
 * Source: WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.INT__CUSTOMER_FUNNEL_V2_CUSTOMER_VALUE_DAILY,
 * summed across all customers per day. EV take is expected value (booked/collected
 * take aren't populated yet), so this is a forward-looking P&L — same basis as the
 * internal Customer Funnel tool.
 */

/** One day of aggregate customer economics. */
export interface CustomerPnlRow {
  /** `YYYY-MM-DD` */
  date: string;
  /** Distinct customers with activity that day. */
  customers: number;
  /** Wonderly's EV take (its cut of expected customer value), USD. */
  evTake: number;
  /** Ad spend Wonderly manages on customers' behalf, USD. */
  adSpend: number;
  /** EV take − ad spend, USD. */
  pnl: number;
}

/** Header row for the customer_pnl tab. Overview formulas reference these by position. */
export const CUSTOMER_PNL_HEADERS = ['DATE', 'CUSTOMERS', 'EV_TAKE', 'AD_SPEND', 'PNL'] as const;

/**
 * Convert customer-P&L rows to the sheet's cell matrix, in header order.
 *
 * @param rows - Daily customer-P&L rows
 */
export function toCustomerPnlValues(rows: CustomerPnlRow[]): (string | number)[][] {
  return rows.map((r) => [r.date, r.customers, r.evTake, r.adSpend, r.pnl]);
}
