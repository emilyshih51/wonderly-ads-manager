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
    'Marketing-qualified leads who booked a Call 1 — the single Call 1 number.',
    'Amplitude qualified + CSM_OPS BOOKING_LINK_INVITEES',
    'A lead who submitted the qualification form AND booked (non-canceled) on the calendar, counted on the day they qualified — so Call 1 booked is always a subset of Qualified, and matches Meta / Amplitude. Excludes rep-assisted / re-engaged bookings that never qualified (those inflate the raw calendar count ~2x). Not the Amplitude BOOKING_COMPLETE event (it misfires).',
  ],
  [
    'BOOKED_FB',
    'wonderly_daily',
    'Booked Call 1s attributed to Facebook.',
    'CSM_OPS + Amplitude',
    'Booking whose invitee email bridges to a facebook/ig utm (or fbclid) marketing session; Organic = everything else.',
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
    "Of that day's booked deals, how many are currently Accepted.",
    'CSM_OPS CRM (sales pipeline)',
    'Current stage type = quote_signed (the “Accepted” stage, a terminal closed_won — current stage is authoritative). Keyed on the stable stage TYPE, scoped to the acquisition pipeline.',
  ],
  [
    'HELD',
    'wonderly_daily, call1_deals',
    'Booked deals whose Call 1 actually happened.',
    'CSM_OPS CRM',
    'A booked deal that reached an offer/acceptance (Pending Offer Out / Accepted) OR is DQ/Lost WITH a loss reason set (a human post-call disposition). Booked DQ/Lost with no loss reason are treated as no-show fallout, not held.',
  ],
  [
    'NO_SHOW',
    'wonderly_daily',
    'Of that day’s booked deals, how many are currently in the “No Show” stage (no-showed the Call 1).',
    'CSM_OPS CRM',
    'Current stage type = meeting_no_show, keyed on the stable stage TYPE (rename-proof) scoped to the acquisition pipeline. Cohort-keyed by booking day (marketing BOOKING_COMPLETE, else CRM creation day, else override).',
  ],
  [
    'DISQUALIFIED',
    'wonderly_daily, call1_deals',
    'Booked deals currently DQ or Lost (independent of HELD — a deal can be both).',
    'CSM_OPS CRM',
    'Current stage type in disqualified / lost (the “DQ” / “Lost” stages).',
  ],
  [
    'HELD_FB / HELD_ORGANIC, ACCEPTED_FB / ACCEPTED_ORGANIC, NO_SHOW_FB / NO_SHOW_ORGANIC',
    'wonderly_daily, Daily Metrics',
    'Held, accepted, and no-show deals split by the channel that produced the Call 1.',
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
    'Cost per Call 1 booked',
    'Overview',
    'What a booking costs, over the last 7 completed days.',
    'Derived',
    '7-day FB_SPEND ÷ 7-day Call 1s booked (BOOKING_COMPLETE). Excludes today’s partial day.',
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
    'Facebook acquisition spend per contractor who succeeds within 60/90 days of acceptance.',
    'Meta + Snowflake (prod value view + Meta spend)',
    'Succeeding = ROI ≥ 2× (EV_OWED modeled expected contribution ÷ actual Meta spend) within 60/90d of the deal’s acceptance date. Cost = FB spend over the cohort’s acceptance window ÷ succeeding; “maturing” until ≥5 clear the bar (acceptances began mid-2026, and 2× is a high bar, so it reads 0 for now).',
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
    'CAMPAIGN_ID / CAMPAIGN_NAME / AD_ID',
    'call1_deals',
    'The Meta campaign and ad that drove the lead — so you can see which campaign/ad produces the most qualified/accepted deals.',
    'Amplitude → CRM + Meta',
    'utm_medium = campaign.id, utm_content = ad.id, set on the ad’s click URL and carried on the lead-submission / booking events; matched to the deal by email, taking the most recent numeric (paid) id. CAMPAIGN_NAME is that id resolved to its Meta display name. Blank for organic/unattributed.',
  ],
  [
    'ACCEPTED_DATE',
    'call1_deals',
    'Day the deal first reached “Accepted”.',
    'CRM',
    'Starts the 60/90-day succeeding clock. Blank if never accepted.',
  ],

  // --- Campaign Performance (per-campaign dashboard) ----------------------
  [
    'CAMPAIGN',
    'Campaign Performance',
    'One row per Meta campaign (plus an organic/unattributed bucket and a Total).',
    'call1_deals + Meta',
    'Campaign display name, resolved from the campaign id on each deal. Campaigns with spend but no deals still appear (so wasted spend is visible).',
  ],
  [
    'CALL1_BOOKED / HELD / ACCEPTED',
    'Campaign Performance',
    'How many Call 1s that campaign booked, and how many held / were accepted.',
    'call1_deals',
    'Counted from the deal rows attributed to the campaign (booking-day cohort, same as Daily Metrics). ACCEPT_RATE = accepted ÷ booked.',
  ],
  [
    'SPEND / COST_PER_ACCEPTED',
    'Campaign Performance',
    'Meta spend for the campaign since May 1, and cost to acquire an accepted contractor.',
    'Meta + call1_deals',
    'Campaign-level spend ÷ accepted from that campaign. Booking-day cohort, so recent campaigns read high until they mature (like historical_cac); blank when there’s spend but no acceptances yet.',
  ],

  // --- booking_overrides (manual input) -----------------------------------
  [
    'DEAL_ID / BOOKED_DAY',
    'booking_overrides',
    'Hand-entered booking day for a deal whose “Call 1 Scheduled” event was never captured (so its acceptance can join the right booking cohort).',
    'Manual',
    'Booked day is derived automatically as the earliest of: first BOOKING_COMPLETE (matched by email) or the CRM deal-creation day (booking creates the deal), falling back to the Call 1 Scheduled event. CREATED_AT covers every deal, so overrides are rarely needed — this tab is a manual correction that wins over all of the above. You own it — the cron only reads it. Put the deal_id (from call1_deals) and a booking date (YYYY-MM-DD).',
  ],

  // --- historical_cac -----------------------------------------------------
  [
    'MONTH / CAC',
    'historical_cac',
    'Cost to acquire an accepted contractor, per booking month + all-time. CAC = FB spend ÷ accepted (that month’s booking cohort). CALL1_BOOKED / ACCEPT_RATE give the funnel context.',
    'Meta spend + Snowflake',
    'Cohort-keyed by booking day. "maturing" months are too recent for their cohort to have finished converting (CAC reads high); the all-time row is the stable figure. Recomputed each run, so past months refine as cohorts mature.',
  ],

  // --- customer_pnl -------------------------------------------------------
  [
    'EV_TAKE / AD_SPEND / PNL',
    'customer_pnl',
    'Wonderly’s modeled expected contribution (EV take), the Meta spend it runs for customers, and EV − spend. PNL is a forward-looking expectation, not realized/collected money.',
    'Snowflake (customer-value view + Meta spend)',
    'Paying customers only (subscription active/past_due). EV take = EV_OWED; AD_SPEND = actual delivered Meta spend (not the value view budget); PNL = EV − actual spend. Matches the Customer Funnel tool. EV is forward-looking, so daily PnL is lumpy and won’t tie to the dollar.',
  ],

  // --- SEO / channel tabs -------------------------------------------------
  [
    'CHANNEL',
    'SEO Metrics',
    'Which acquisition channel a visit, lead or deal is attributed to: Organic search (SEO), AI search, Direct, Referral, Other campaign, or Facebook (paid).',
    'Amplitude + CRM',
    'First-match ladder: fb = the session carried a Facebook signal (utm_source facebook/ig or an fbclid) — byte-identical to the FB/Organic split on wonderly_daily, so the channels sum back to it. Everything else is judged on FIRST TOUCH (initial_utm_source / initial_referrer): ai = an LLM referrer (ChatGPT, Perplexity, Claude, Gemini, Copilot); seo = a search-engine referrer with no campaign utm; other = some other campaign utm; direct = no referrer at all (or an internal wonderly.com hop); referral = any other external domain. First touch on purpose — an SEO visitor who returns by typing the URL is still SEO, which last-touch would misfile as Direct.',
  ],
  [
    'SEO / ALL / SEO %',
    'SEO Metrics',
    'Per-metric columns on the SEO grid: the organic-search count, the all-channel total for the same metric, and organic’s share of it.',
    'Amplitude + CSM_OPS CRM',
    'SEO = the count whose CHANNEL is seo. ALL is the day counted WHOLE — its own COUNT(DISTINCT …), not the sum of the channels: one person can appear in two channels the same day (an fbclid on one hit and not the next), so summing runs ~0.2%/day high, and ALL also carries the deals no channel could be found for. That is what makes ALL tie out to wonderly_daily. SEO % = SEO ÷ ALL. Windowed rows (weekly, 7d avg, MTD, Prev Month) compute it as a ratio of totals (Σ SEO ÷ Σ ALL), never an average of daily percentages — a 20-view day must not weigh the same as a 200-view day.',
  ],
  [
    'Page views',
    'SEO Metrics',
    'The top-of-funnel row: how many PEOPLE viewed the marketing site that day — not visits, and not page-view events.',
    'Amplitude',
    'COUNT(DISTINCT AMPLITUDE_ID) on MARKETING_SITE__PAGE__VIEW — the same measure wonderly_daily reports as PAGE_VIEW, so the two tabs are directly comparable. One person browsing five pages across two visits counts once. For scale: on 2026-08-25 organic search was 69 people, across 78 Amplitude sessions and 131 page-view events.',
  ],
  [
    'Conv',
    'SEO Metrics',
    'The leading column on each stage: what share of the previous step made it to this one, within organic search only.',
    'Derived',
    'Conv = this stage’s SEO count ÷ the previous stage’s SEO count (Page views → CTA → Partial → Qualified → Call 1 booked → Held/Accepted). It sits where Daily Metrics puts Cost, because SEO has no media spend to divide by. Blank (not 0%) when the previous step was empty. Ratio of totals on all windowed rows. No show has no Conv — it is a disposition of a booked call, not a funnel step.',
  ],
  [
    '7d avg / MTD / Prev Month / Week of …',
    'SEO Metrics',
    'The same daily-plus-weekly cadence as Daily Metrics, applied to organic search.',
    'Sheet formulas + derived',
    'Daily rows run newest-first in ISO-week blocks, each closed by a shaded "Week of <Monday>" summary row (sums for counts, ratio-of-totals for rates). Above them, 7d avg / MTD / Prev Month are live sheet formulas — 7d avg = the last 7 completed days (today’s partial row is skipped), MTD/Prev Month are EOMONTH(TODAY()) windows that self-advance. w/w compares a day to the same weekday a week earlier; Accepted and No show drop it, since organic runs 0–2 a day and the percentage is pure noise at that scale.',
  ],
  [
    'SEO Call 1 booked / Held / Accepted',
    'SEO Metrics',
    "Organic search's Call 1 bookings, calls that actually happened, and accepted contractors.",
    'Amplitude + CSM_OPS CRM',
    'Identical rules to the blended tabs, with the channel added: booked = a marketing-qualified lead who booked, keyed to their QUALIFIED day (so it stays a subset of Qualified); held / accepted are COHORT metrics keyed to the deal booking day, read from the CRM current stage TYPE. Recent days read low until the cohort matures.',
  ],
  [
    'PATH',
    'SEO Pages',
    'The organic landing page a person arrived on, credited with their whole funnel.',
    'Amplitude',
    "First-touch: the path of that person's EARLIEST page view in the window (MIN_BY on EVENT_TIME). Someone who lands on /pricing, reads three more pages and books is a /pricing conversion — it measures what the page won from the search result. Pages under 10 sessions fold into '(other pages)' unless they produced a booking.",
  ],
  [
    'No cost-per columns on the SEO tabs',
    'SEO Metrics, SEO Pages',
    'Deliberate omission — SEO carries no media cost to divide by.',
    'n/a',
    "Cost per stage = FB spend ÷ actions, which is meaningless for a channel with no spend. On SEO Metrics that column slot carries Conv instead. SEO's unit of investment is the PAGE, which is what SEO Pages reports. Paid economics stay on Daily Funnel and Campaign Performance.",
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
    'Cost / ALL / w/w / FB / Organic',
    'Daily Metrics',
    'Per-stage columns: a cost per action (first), the total, its week-over-week change, and the FB vs Organic split.',
    'Derived',
    'Cost = FB spend ÷ that stage’s count — per day it’s the day’s spend ÷ that day’s count; the 7d/MTD/Prev rows use ratio of totals (Σ spend ÷ Σ actions). Only the funnel stages have a Cost column; Spend and CPC are inputs (no Cost). w/w compares to the previous 7 completed days.',
  ],
  [
    '7d avg / MTD / Prev Month',
    'Daily Metrics',
    'Summary rows above the daily grid, written as live editable sheet formulas.',
    'Sheet formulas',
    '7d avg = AVERAGE of the last 7 days (shown to 1 decimal, so held/accepted don’t round to 0); MTD = SUMIFS of the current month; Prev Month = SUMIFS of last month. w/w compares each to the prior period. CPC uses AVERAGE/AVERAGEIFS.',
  ],
];

/**
 * The Definitions matrix in DEFINITIONS_HEADERS order.
 */
export function toDefinitionsValues(): (string | number)[][] {
  return DEFINITIONS.map((d) => [...d]);
}
