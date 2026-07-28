/**
 * Definitions — a glossary for every field the workbook writes.
 *
 * The Growth Sheet spec asks for a "Definitions and Data Problems" tab so that no
 * number is a mystery: each field gets its meaning, its source system, and the exact
 * counting rule. This is a static table the cron writes to the "Definitions" tab; the
 * live data-quality signals (freshness, week-over-week drop, attribution rate) live as
 * warnings on the Overview and in the `meta` tab.
 */

/** Column order for the Definitions tab. */
export const DEFINITIONS_HEADERS = [
  'FIELD',
  'WHERE',
  'MEANING',
  'SOURCE',
  'HOW IT IS COUNTED',
] as const;

/** [field, where, meaning, source, rule] for every documented field. */
const DEFINITIONS: readonly [string, string, string, string, string][] = [
  // --- Dates & spend ------------------------------------------------------
  [
    'DATE',
    'wonderly_daily, Daily Funnel',
    'The calendar day a metric belongs to.',
    'Meta + Amplitude',
    'Bucketed by Pacific time (to match Amplitude), not UTC.',
  ],
  [
    'FB_SPEND',
    'wonderly_daily, Daily Funnel',
    'Facebook ad spend to acquire contractors that day.',
    'Meta',
    "Spend on Wonderly's own ad account (not client ad spend).",
  ],
  [
    'FB_IMPRESSIONS',
    'wonderly_daily',
    'Ad impressions delivered that day.',
    'Meta',
    'From the Meta Marketing API.',
  ],
  [
    'FB_CLICKS',
    'wonderly_daily',
    'Ad link clicks that day.',
    'Meta',
    'Inline link clicks from the Meta Marketing API.',
  ],

  // --- Marketing funnel (Amplitude, unique people) ------------------------
  [
    'PAGE_VIEW / VISITS',
    'wonderly_daily / Daily Funnel',
    'People who viewed the marketing site.',
    'Amplitude',
    'Distinct users on MARKETING_SITE__PAGE__VIEW (dedupes the double-fire).',
  ],
  [
    'CTA_CLICKED / CTA',
    'wonderly_daily / Daily Funnel',
    'People who clicked the beta-form call-to-action.',
    'Amplitude',
    'Distinct users on MARKETING_SITE__BETA_FORM_CTA__CLICKED.',
  ],
  [
    'SUBMIT_PARTIAL / PARTIAL',
    'wonderly_daily / Daily Funnel',
    'People who started the form (partial submit).',
    'Amplitude',
    'Distinct users on MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL.',
  ],
  [
    'SUBMIT_QUALIFIED / QUALIFIED',
    'wonderly_daily / Daily Funnel',
    'People who submitted the qualified form.',
    'Amplitude',
    'Distinct users on MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED.',
  ],
  [
    'BOOKED_ALL / CALL1_BOOKED',
    'wonderly_daily / Daily Funnel',
    'People who completed a booking — the single Call 1 number. Matches Amplitude.',
    'Amplitude',
    'Distinct users on MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE.',
  ],
  [
    'BOOKED_FB',
    'wonderly_daily',
    'Bookings attributed to Facebook.',
    'Amplitude',
    'BOOKING_COMPLETE where utm_source is facebook/ig OR an fbclid is present.',
  ],
  [
    'BOOKED_ORGANIC',
    'wonderly_daily',
    'Bookings not attributed to Facebook.',
    'Amplitude',
    'BOOKING_COMPLETE without a Facebook signal.',
  ],
  [
    '<STEP>_FB / <STEP>_ORGANIC',
    'wonderly_daily, Daily Metrics',
    'Each funnel step split by channel — page views, CTA, partial, qualified, and bookings.',
    'Amplitude',
    'Every marketing event carries the session utm_source/fbclid, so FB = facebook/ig utm OR an fbclid; Organic = everything else. The split is visible from page view on.',
  ],

  // --- Sales outcomes (CRM cohort, keyed to booking day) ------------------
  [
    'ACCEPTED',
    'wonderly_daily, call1_deals',
    "Of that day's booked deals, how many ever reached “Accepted”.",
    'CRM (sales pipeline)',
    'Ever-reached milestone from the deal stage-change events — stays 1 even if the deal later moves.',
  ],
  [
    'HELD',
    'wonderly_daily, call1_deals',
    'Booked deals whose Call 1 actually happened.',
    'CRM',
    'Current stage is past “Call 1 Scheduled” and not the no-show stage.',
  ],
  [
    'NO_SHOW',
    'wonderly_daily, call1_deals',
    'Booked deals that no-showed the Call 1.',
    'CRM',
    'Current stage = “Call Missed Several Times”.',
  ],
  [
    'DISQUALIFIED_LOST',
    'wonderly_daily, call1_deals',
    'Booked deals currently disqualified or lost.',
    'CRM',
    'Current stage = “Disqualified or Lost”.',
  ],
  [
    'HELD_FB / HELD_ORGANIC, ACCEPTED_FB / ACCEPTED_ORGANIC',
    'wonderly_daily, Daily Metrics',
    'Held and accepted deals split by the channel that produced the Call 1.',
    'CRM + Amplitude',
    'Each deal is matched to its booking source by contact email (same bridge as call1_deals SOURCE). FB = facebook/ig; Organic = ALL − FB (includes unattributed deals).',
  ],

  // --- Daily Funnel derived ----------------------------------------------
  [
    'COST_PER_<STEP>',
    'Daily Funnel',
    'Cost to reach a step that day.',
    'Derived',
    'FB_SPEND ÷ that step’s count (e.g. COST_PER_CALL1 = spend ÷ Call 1s booked).',
  ],
  ['CTA_RATE', 'Daily Funnel', 'Visit → CTA conversion.', 'Derived', 'CTA ÷ VISITS.'],
  ['PARTIAL_RATE', 'Daily Funnel', 'CTA → partial-form conversion.', 'Derived', 'PARTIAL ÷ CTA.'],
  [
    'QUAL_RATE',
    'Daily Funnel',
    'Partial → qualified-form conversion.',
    'Derived',
    'QUALIFIED ÷ PARTIAL.',
  ],
  [
    'CALL1_RATE',
    'Daily Funnel',
    'Qualified form → Call 1 booked conversion.',
    'Derived',
    'CALL1_BOOKED ÷ QUALIFIED.',
  ],
  [
    'HELD_RATE',
    'Daily Funnel',
    'Of Call 1s booked, the share that were held.',
    'Derived',
    'HELD ÷ CALL1_BOOKED.',
  ],
  [
    'ACCEPT_RATE',
    'Daily Funnel',
    'Of Call 1s booked, the share ever accepted.',
    'Derived',
    'ACCEPTED ÷ CALL1_BOOKED.',
  ],

  // --- Overview week-over-week -------------------------------------------
  [
    'THIS_7D',
    'Overview',
    'Total over the last 7 days.',
    'Derived',
    'Sum of the 7 newest daily rows.',
  ],
  [
    'PREV_7D',
    'Overview',
    'Total over the 7 days before that.',
    'Derived',
    'Sum of daily rows 8–14.',
  ],
  ['CHANGE', 'Overview', 'Absolute change between the two weeks.', 'Derived', 'THIS_7D − PREV_7D.'],
  [
    'PCT_CHANGE',
    'Overview',
    'Percent change in the count between the two weeks.',
    'Derived',
    '(THIS_7D − PREV_7D) ÷ PREV_7D.',
  ],
  [
    'CONVERSION',
    'Overview',
    'This week’s conversion from the prior step.',
    'Derived',
    'Summed numerator ÷ summed denominator over the 7 days.',
  ],
  [
    'COST_PER_RESULT',
    'Overview',
    'This week’s cost per result for the step.',
    'Derived',
    '7-day FB_SPEND ÷ 7-day count.',
  ],
  [
    'COST_PCT_CHANGE',
    'Overview',
    'Change in cost per result vs last week. Positive = more expensive.',
    'Derived',
    '(cost this 7d − cost prev 7d) ÷ cost prev 7d.',
  ],

  // --- Overview headline KPIs --------------------------------------------
  [
    'Cost per confirmed Call 1',
    'Overview',
    'What a booking costs, last 7 days.',
    'Derived',
    '7-day FB_SPEND ÷ 7-day Call 1s booked.',
  ],
  [
    'Cost per accepted contractor',
    'Overview',
    'What an accepted contractor costs, last 7 days.',
    'Derived',
    '7-day FB_SPEND ÷ 7-day accepted (note: recent acceptances are still maturing).',
  ],
  [
    'Cost per succeeding contractor (60/90d)',
    'Overview',
    'Facebook acquisition spend per contractor who succeeds within 60/90 days of go-live.',
    'Meta + Snowflake (prod value view)',
    'Succeeding = cumulative PNL_USD > 0 within 60/90d of a team’s AD_START_DATE. Cost = total FB spend ÷ succeeding contractors; shows “maturing” until ≥5 have matured (data began 2026, so cohorts are still aging).',
  ],

  // --- call1_deals (deal-level audit trail) ------------------------------
  [
    'DEAL_ID',
    'call1_deals',
    'The CRM deal’s unique id.',
    'CRM',
    'From the deal stage-change events.',
  ],
  ['DEAL_NAME', 'call1_deals', 'CRM deal name (contact + company).', 'CRM', 'CRM_DEALS.NAME.'],
  [
    'BOOKED_DAY',
    'call1_deals',
    'Day the deal entered “Call 1 Scheduled”.',
    'CRM',
    'Earliest Call-1-Scheduled event date (Pacific).',
  ],
  [
    'CURRENT_STAGE',
    'call1_deals',
    'The deal’s live pipeline stage.',
    'CRM',
    'CRM_DEALS → CRM_PIPELINE_STAGES snapshot.',
  ],
  [
    'EST_AMOUNT',
    'call1_deals',
    'The rep’s estimated deal value.',
    'CRM',
    'CRM_DEALS.ESTIMATED_AMOUNT.',
  ],
  [
    'CONTACT_NAME / PHONE / EMAIL',
    'call1_deals',
    'Primary contact details, for finding the person.',
    'CRM',
    'CRM_CONTACTS + CRM_CONTACT_EMAILS (primary email).',
  ],
  [
    'SOURCE',
    'call1_deals',
    'Marketing source of the deal (e.g. facebook).',
    'Amplitude → CRM',
    'From the form-submit event, matched by email; falls back utm → user-property utm → referrer → fbclid. Blank = unattributed.',
  ],
  [
    'ACCEPTED_DATE',
    'call1_deals',
    'Day the deal first reached “Accepted”.',
    'CRM',
    'Starts the 60/90-day succeeding clock. Blank if never accepted.',
  ],

  // --- customer_pnl -------------------------------------------------------
  [
    'EV_TAKE / AD_SPEND / PNL',
    'customer_pnl',
    'Wonderly’s cut of customer value, the ad spend it runs for customers, and the P&L.',
    'Snowflake (customer-value view)',
    'Summed across customers per day; EV is expected value, so this is forward-looking.',
  ],

  // --- meta ---------------------------------------------------------------
  [
    'LAST_REFRESHED_PT',
    'meta, Overview',
    'When the cron last wrote the sheet.',
    'Cron',
    'Set every run in Pacific time.',
  ],
  ['NEWEST_DATE', 'meta', 'The most recent day of data.', 'Derived', 'Max DATE in wonderly_daily.'],

  // --- Daily Metrics grid -------------------------------------------------
  [
    'ALL / w/w / FB / Organic',
    'Daily Metrics',
    'Per-metric columns: the total, its week-over-week change, and the FB vs Organic split.',
    'Derived',
    'w/w compares each day to the same weekday last week (7 rows back). FB/Organic populated for spend and the funnel steps; blank for CPC, Held, Accepted (no channel split yet).',
  ],
  [
    '7d avg / MTD / Prev Month',
    'Daily Metrics',
    'Summary rows above the daily grid.',
    'Derived',
    '7d avg = mean of the last 7 days (w/w vs the 7 before); MTD = month-to-date sum (w/w vs the same span last month); Prev Month = last month’s total.',
  ],
];

/**
 * The Definitions matrix in DEFINITIONS_HEADERS order.
 */
export function toDefinitionsValues(): (string | number)[][] {
  return DEFINITIONS.map((d) => [...d]);
}
