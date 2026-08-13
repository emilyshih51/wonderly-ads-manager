/**
 * SnowflakeService — reads the daily marketing funnel from the Snowflake data share.
 *
 * Wonderly's Amplitude marketing-funnel events land in `AMPLITUDE.AMPLITUDE.EVENTS_766268`;
 * sales outcomes (held / no-show / accepted) come from the `AIRBYTE.CSM_OPS.*` CRM current
 * stage TYPE, not the Amplitude `WONDERLY_SALES__DEAL__STAGE_CHANGE` events (which fire for too
 * few stages to be reliable). This service runs ONE aggregation query per cron run: Snowflake
 * does the counting and returns ~35 daily rows, so the app never moves raw events around.
 *
 * Meta spend is NOT read here — it comes from the Meta Marketing API (the
 * Facebook → Fivetran connector that would land spend in Snowflake is dead). The
 * cron joins spend to these outcomes by date.
 */

import snowflake, { type Connection } from 'snowflake-sdk';

import type { CampCohortCounts } from '@/lib/acquisition-update';
import type { Call1DealRow } from '@/lib/call1-deals';
import type { CustomerPnlRow } from '@/lib/customer-pnl';
import type { SucceedingContractors } from '@/lib/succeeding';
import type { DailyMarketingRow } from '@/lib/marketing-daily';

/** wonderly-prod events table. The name embeds the Amplitude project id. */
const EVENTS_TABLE = 'AMPLITUDE.AMPLITUDE.EVENTS_766268';

/**
 * Wonderly's contractor-acquisition pipeline in the CSM Ops CRM (`AIRBYTE.CSM_OPS.*`). This
 * schema holds only Wonderly's own sales CRM (one pipeline, 9 clean stages), unlike the retired
 * `WONDERLY_DEV.*` which mixed in 1000+ contractor job pipelines. Every stage lookup still scopes
 * to this pipeline id (stable across stage renames, unlike NAME) so a rename can't break a metric.
 */
const ACQUISITION_PIPELINE_ID = 'pip_019c0568f48a7a0c8d41d87efeafadd4';

/**
 * Sales stages are keyed on their semantic `TYPE` (a stable enum) rather than display NAME, which
 * gets renamed. In the CSM_OPS pipeline every type is unique, so these are exact:
 *   meeting_scheduled = Call 1 Scheduled · rescheduled = Rescheduled · meeting_no_show = No Show ·
 *   quote_and_invoice_sent = Pending Offer Out · quote_signed = Accepted (closed_won) ·
 *   disqualified = DQ · lost = Lost.
 */
const NO_SHOW_STAGE_TYPE = 'meeting_no_show';
const ACCEPTED_STAGE_TYPE = 'quote_signed';

/**
 * Stage types that only a *booked* deal reaches — used as a fallback "was booked" signal for
 * deals with no marketing BOOKING_COMPLETE / Call 1 Scheduled event (e.g. outbound). DQ and Lost
 * are deliberately excluded: a deal can be disqualified without ever booking a call, so those need
 * an explicit booking signal to count.
 */
const BOOKED_STAGE_TYPES = [
  'meeting_scheduled',
  'rescheduled',
  'meeting_no_show',
  'quote_and_invoice_sent',
  'quote_signed',
];

/** Post-call stages where the offer was made or accepted (unambiguously "held"). */
const OFFER_STAGE_TYPES = ['quote_and_invoice_sent', 'quote_signed'];

/** Terminal negative stages (DQ / Lost). Counted as "held" only when booked AND a loss reason is set. */
const DQ_LOST_STAGE_TYPES = ['disqualified', 'lost'];

/** Render a string array as a SQL IN-list literal, e.g. ['a','b'] → `'a','b'`. */
function sqlIn(types: string[]): string {
  return types.map((t) => `'${t}'`).join(',');
}

/**
 * Timezone the daily buckets are cut on. Amplitude events land in UTC, but the
 * Amplitude UI (and how the team reads these numbers) is in the project's timezone.
 * Bucketing on UTC pushes a US-evening booking into the next calendar day, so the
 * sheet would read higher than Amplitude on the current day. Grouping by this tz
 * makes every day line up with Amplitude. Change this if the project timezone changes.
 */
const REPORT_TZ = 'America/Los_Angeles';

/**
 * Amplitude exclusion cohorts replicated in SQL so the sheet matches the Amplitude charts,
 * which filter these out: Test Accounts (email contains test/wonderly/motion/tanya), Internal
 * Wonderly (wonderly.com/usemotion.com — caught by the substrings), and the Design Partners /
 * Design Partners with Ads lists. All are email-rule cohorts. **Update these if the Design
 * Partners cohorts change in Amplitude** (cohort ids urrlbtg2 / euq2js5s / ujlb6h0x / lv6hfo0w).
 */
const EXCLUDED_EMAIL_SUBSTRINGS =
  'test|wonderly|motion|tanya|gccg|smartbeertap|tamarack|airsenseenvironmental|houstonsigncrafters|huggibearexpress|modernlalaland|chicsketch|garvit03jain|callhuggibear';
const EXCLUDED_EMAIL_EXACT = [
  'keith@theestatelawyer.com',
  'homesheartskitchens@gmail.com',
  'taylor@launchpartners.consulting',
  'josh@rnkd123.com',
  'echodogstraining@gmail.com',
  'exodiuscommercial@gmail.com',
  'tidylawnsga@gmail.com',
  'jeff@activtrim.com',
  'david@getcontentsponge.com',
];

/**
 * SQL boolean predicate — true when the (already lowercased) email column belongs to an
 * exclusion cohort. Snowflake RLIKE is whole-string, so the substrings are wrapped in `.*….*`.
 *
 * @param col - A lowercased email SQL expression (e.g. `em.join_email`)
 */
function excludedEmail(col: string): string {
  const exact = EXCLUDED_EMAIL_EXACT.map((e) => `'${e}'`).join(',');

  return `(${col} RLIKE '.*(${EXCLUDED_EMAIL_SUBSTRINGS}).*' OR ${col} IN (${exact}))`;
}

/**
 * SQL boolean predicate — true when a CRM deal NAME is a QA test deal. The quote/contract
 * pipeline generates deals named `QID-<n>-<hash>-<ts>-…-Deal` (~22 of them, some with null or
 * shared gmail emails that the email filter misses); they're created and "accepted" the same
 * day and never touch the marketing funnel, so they leak into the sales cohorts otherwise.
 * `COALESCE(..., FALSE)` keeps null-named real deals.
 *
 * @param col - A deal-name SQL expression (e.g. `cd.NAME`)
 */
function excludedDealName(col: string): string {
  return `COALESCE(LOWER(${col}) RLIKE '.*(qid-[0-9]).*', FALSE)`;
}

/** Data-team-owned view: one row per customer per day of funnel value + P&L. */
const CUSTOMER_VALUE_DAILY =
  'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.INT__CUSTOMER_FUNNEL_V2_CUSTOMER_VALUE_DAILY';

/** Prod teams dimension — 1:1 with the value view's teams, carries the ad go-live date. */
const BASE_TEAMS = 'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.BASE__TEAMS';

/** Actual delivered Meta spend per customer per day (the value view's AD_SPEND is budget). */
const CUSTOMER_META_SPEND_DAILY =
  'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.FCT__CUSTOMER_META_SPEND_DAILY';

/**
 * Acquisition-side CRM deals mirrored into the warehouse — the only table carrying both the
 * Wonderly sales deal and its contractor contact email, so it anchors the CAMP cohort join.
 */
const CUSTOMER_TO_WONDERLY_DEAL =
  'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.STG__CUSTOMER_TO_WONDERLY_DEAL';

/**
 * CAMP's per-customer, per-week lifecycle fact — the "WoW Success" view. Carries
 * `DEAL_SCORE_CLASSIFICATION` (Succeeding / Okay / Not Good / Failing) plus the weekly
 * won-deal, booked and collected revenue-share amounts.
 */
const LIFECYCLE_WEEKLY =
  'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.FACT__CUSTOMER_FUNNEL_V2_LIFECYCLE_WEEKLY';

interface SnowflakeConfig {
  account: string;
  username: string;
  password: string;
  warehouse?: string;
  role?: string;
}

/**
 * A manual booking-day override for a deal whose "Call 1 Scheduled" event was never
 * captured. Sourced from the `booking_overrides` sheet tab and injected into the sales
 * queries so the deal's acceptance lands in the right booking cohort.
 */
export interface BookingOverride {
  dealId: string;
  /** `YYYY-MM-DD` booking day to use for this deal. */
  bookedDay: string;
}

/** Serialize overrides for the query's PARSE_JSON override CTE (a single bound param). */
function overridesJson(overrides: BookingOverride[]): string {
  return JSON.stringify(overrides.map((o) => ({ deal_id: o.dealId, booked_day: o.bookedDay })));
}

export class SnowflakeService {
  private conn: Connection | null = null;

  constructor(private readonly config: SnowflakeConfig) {}

  /**
   * Build a service from environment variables.
   *
   * @throws When a required Snowflake connection variable is missing
   */
  static fromEnv(): SnowflakeService {
    const account = process.env.SNOWFLAKE_ACCOUNT;
    const username = process.env.SNOWFLAKE_USERNAME;
    const password = process.env.SNOWFLAKE_PASSWORD;

    if (!account || !username || !password) {
      throw new Error(
        'Snowflake credentials missing: set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, SNOWFLAKE_PASSWORD'
      );
    }

    return new SnowflakeService({
      account,
      username,
      password,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
    });
  }

  /** Connect lazily and reuse the connection across queries in one cron run. */
  private async connect(): Promise<Connection> {
    if (this.conn) return this.conn;

    const connection = snowflake.createConnection({
      account: this.config.account,
      username: this.config.username,
      password: this.config.password,
      warehouse: this.config.warehouse,
      role: this.config.role,
    });

    await new Promise<void>((resolve, reject) => {
      connection.connect((err: Error | undefined) => (err ? reject(err) : resolve()));
    });

    this.conn = connection;

    return connection;
  }

  /**
   * Run a parameterised query and return typed rows.
   *
   * @param sqlText - SQL with `?` bind placeholders
   * @param binds - Values for the placeholders, in order
   */
  private async query<T>(sqlText: string, binds: (string | number)[] = []): Promise<T[]> {
    const connection = await this.connect();

    return new Promise<T[]>((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (err: Error | undefined, _stmt: unknown, rows: unknown[] | undefined) =>
          err ? reject(err) : resolve((rows ?? []) as T[]),
      });
    });
  }

  /**
   * Daily marketing funnel + booking-by-source + sales stages for the last N days.
   *
   * Counts are UNIQUE PEOPLE per stage (`COUNT(DISTINCT AMPLITUDE_ID)`), so the
   * ~2x event double-fire doesn't inflate them. A booking counts as `fb` when its
   * session carried a Facebook signal — `utm_source` facebook/ig OR an `fbclid`
   * (harder to fool than utm alone); everything else is `organic`.
   *
   * Sales outcomes (held / no-show / accepted) come from the CSM_OPS CRM current stage TYPE,
   * cohort-keyed by booking day — not the Amplitude stage-change events.
   *
   * @param days - Trailing window to pull, e.g. 35
   * @param bookingOverrides - Manual deal_id → booked_day fills for deals missing the event
   * @returns One row per day, newest first
   */
  async getDailyMarketing(
    days: number,
    bookingOverrides: BookingOverride[] = []
  ): Promise<DailyMarketingRow[]> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH ovr AS (
         SELECT value:deal_id::string AS deal_id, TRY_TO_DATE(value:booked_day::string) AS booked_day
         FROM TABLE(FLATTEN(input => PARSE_JSON(?)))
       ),
       -- Users in the Amplitude exclusion cohorts (test / internal / design partners), by
       -- their amplitude_id, so their events drop out of the funnel — matching the Amplitude
       -- charts. Identified from any marketing event whose email matches an exclusion rule.
       excluded_amps AS (
         SELECT DISTINCT AMPLITUDE_ID
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE LIKE 'MARKETING_SITE%'
           AND EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
           AND ${excludedEmail('LOWER(COALESCE(USER_PROPERTIES:email::string, EVENT_PROPERTIES:email::string))')}
       ),
       mkt AS (
         SELECT CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date AS day, EVENT_TYPE, AMPLITUDE_ID,
           LOWER(COALESCE(EVENT_PROPERTIES:utm_source::string,'')) AS src,
           EVENT_PROPERTIES:fbclid::string AS fbclid
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
           AND EVENT_TYPE LIKE 'MARKETING_SITE%'
           AND AMPLITUDE_ID NOT IN (SELECT AMPLITUDE_ID FROM excluded_amps)
       ),
       -- Every marketing event carries the session's utm_source / fbclid, so each
       -- funnel step splits into FB (facebook/ig utm OR an fbclid) vs organic the
       -- same way bookings do — the channel signal is visible from page view on.
       f AS (
         SELECT day,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' THEN AMPLITUDE_ID END) AS page_view,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW'
                AND (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS page_view_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW'
                AND NOT (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS page_view_organic,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' THEN AMPLITUDE_ID END) AS cta_clicked,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED'
                AND (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS cta_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED'
                AND NOT (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS cta_organic,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' THEN AMPLITUDE_ID END) AS submit_partial,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL'
                AND (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS partial_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL'
                AND NOT (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS partial_organic,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' THEN AMPLITUDE_ID END) AS submit_qualified,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED'
                AND (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS qualified_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED'
                AND NOT (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS qualified_organic,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' THEN AMPLITUDE_ID END) AS booked_all,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE'
                AND (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS booked_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE'
                AND NOT (src IN ('facebook','ig') OR fbclid IS NOT NULL) THEN AMPLITUDE_ID END) AS booked_organic
         FROM mkt GROUP BY day
       ),
       -- ACCEPTED / HELD / NO-SHOW are COHORT metrics keyed to the deal's booking day: of a given
       -- day's bookings, how many eventually held / were accepted / no-showed (recent days read low
       -- until the cohort matures). They're read entirely from the CSM_OPS CRM current stage TYPE
       -- below — the Amplitude WONDERLY_SALES__DEAL__STAGE_CHANGE events are not used at all (they
       -- fire for only a couple of stages, so they're unreliable for the funnel).
       -- Primary email per contact, to bridge a CRM deal back to its marketing source.
       em AS (
         SELECT CONTACT_ID,
           LOWER(COALESCE(MAX(CASE WHEN IS_PRIMARY THEN EMAIL END), MAX(EMAIL))) AS join_email
         FROM AIRBYTE.CSM_OPS.CRM_CONTACT_EMAILS
         WHERE DELETED_AT IS NULL
         GROUP BY CONTACT_ID
       ),
       sub_amp AS (
         SELECT LOWER(EVENT_PROPERTIES:email::string) AS email, AMPLITUDE_ID
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE IN ('MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL','MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED')
           AND EVENT_PROPERTIES:email IS NOT NULL
         GROUP BY 1, 2
       ),
       bc_amp AS (
         SELECT AMPLITUDE_ID, MIN(CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date) AS bc
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE = 'MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE'
         GROUP BY 1
       ),
       email_bc AS (
         SELECT s.email, MIN(b.bc) AS bc FROM sub_amp s JOIN bc_amp b ON b.AMPLITUDE_ID = s.AMPLITUDE_ID GROUP BY 1
       ),
       -- CRM deal-creation day. In CSM_OPS a deal is created for every lead (not just booked ones),
       -- so created_day only anchors the booking cohort for deals already gated as booked below.
       crt AS (
         SELECT ID AS deal_id, CONVERT_TIMEZONE('${REPORT_TZ}', CREATED_AT)::date AS created_day
         FROM AIRBYTE.CSM_OPS.CRM_DEALS
       ),
       -- Marketing source per email, from the form-submit events (same fallback chain
       -- as the call1_deals SOURCE column): event utm -> user utm -> initial utm ->
       -- referrer domain -> fbclid. Lets us attribute each deal's Call 1 to a channel.
       src_raw AS (
         SELECT LOWER(EVENT_PROPERTIES:email::string) AS email, EVENT_TIME,
           COALESCE(
             NULLIF(EVENT_PROPERTIES:utm_source::string,''),
             NULLIF(USER_PROPERTIES:utm_source::string,''),
             NULLIF(USER_PROPERTIES:initial_utm_source::string,''),
             CASE
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%facebook%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%facebook%'
                 OR EVENT_PROPERTIES:fbclid IS NOT NULL THEN 'facebook'
             END
           ) AS source
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE IN ('MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL','MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED')
           AND EVENT_PROPERTIES:email IS NOT NULL
           AND EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
       ),
       src AS (
         SELECT email, MAX_BY(source, CASE WHEN source IS NOT NULL THEN EVENT_TIME END) AS utm_source
         FROM src_raw GROUP BY 1
       ),
       -- One row per acquisition-pipeline CRM deal: current stage TYPE, loss reason, booking day,
       -- booking signals, and a channel flag. Everything downstream keys on the stable stage TYPE
       -- (rename-proof), scoped to Wonderly's own pipeline.
       ds AS (
         SELECT
           -- Booking day (cohort key): manual override, else the earlier of the BOOKING_COMPLETE
           -- bridge and the CRM creation day.
           COALESCE(o.booked_day, LEAST(NVL(ebc.bc, crt.created_day), NVL(crt.created_day, ebc.bc))) AS day,
           st.TYPE AS stage_type,
           NULLIF(cd.LOSS_REASON_KEY, '') AS loss_reason,
           CASE WHEN LOWER(src.utm_source) IN ('facebook','ig') THEN 1 ELSE 0 END AS is_fb,
           -- Booked = a genuine booking signal (marketing BOOKING_COMPLETE or a manual override) OR
           -- a current stage only booked deals reach. This gates DQ/Lost so pre-call junk leads
           -- (no booking signal) never count as held.
           CASE WHEN o.booked_day IS NOT NULL OR ebc.bc IS NOT NULL
                     OR st.TYPE IN (${sqlIn(BOOKED_STAGE_TYPES)})
                THEN 1 ELSE 0 END AS booked
         FROM AIRBYTE.CSM_OPS.CRM_DEALS cd
         JOIN AIRBYTE.CSM_OPS.CRM_PIPELINE_STAGES st
           ON st.ID = cd.PIPELINE_STAGE_ID AND st.PIPELINE_ID = '${ACQUISITION_PIPELINE_ID}'
         LEFT JOIN ovr o ON o.deal_id = cd.ID
         LEFT JOIN em ON em.CONTACT_ID = cd.PRIMARY_CONTACT_PERSON_ID
         LEFT JOIN email_bc ebc ON ebc.email = em.join_email
         LEFT JOIN crt ON crt.deal_id = cd.ID
         LEFT JOIN src ON src.email = em.join_email
         WHERE cd.DELETED_AT IS NULL
           AND (em.join_email IS NULL OR NOT ${excludedEmail('em.join_email')})
           AND NOT ${excludedDealName('cd.NAME')}
       ),
       -- Cohort aggregate keyed by booking day (FB/organic split). Definitions:
       --   NO-SHOW  = current stage No Show (meeting_no_show).
       --   ACCEPTED = current stage Accepted (quote_signed — a terminal closed_won).
       --   HELD     = booked deals that reached an offer / acceptance (Pending Offer Out, Accepted)
       --              OR a DQ/Lost that carries a LOSS_REASON_KEY (a human post-call disposition).
       --              Booked DQ/Lost with no loss reason are no-show fallout, NOT held.
       s AS (
         SELECT day,
           SUM(held) AS held, SUM(held * is_fb) AS held_fb, SUM(held * (1 - is_fb)) AS held_organic,
           SUM(accepted) AS accepted, SUM(accepted * is_fb) AS accepted_fb, SUM(accepted * (1 - is_fb)) AS accepted_organic,
           SUM(no_show) AS no_show, SUM(no_show * is_fb) AS no_show_fb, SUM(no_show * (1 - is_fb)) AS no_show_organic,
           SUM(disqualified_lost) AS disqualified_lost
         FROM (
           SELECT day, is_fb,
             CASE WHEN stage_type = '${ACCEPTED_STAGE_TYPE}' THEN 1 ELSE 0 END AS accepted,
             CASE WHEN stage_type = '${NO_SHOW_STAGE_TYPE}' THEN 1 ELSE 0 END AS no_show,
             CASE WHEN booked = 1 AND (
                        stage_type IN (${sqlIn(OFFER_STAGE_TYPES)})
                        OR (stage_type IN (${sqlIn(DQ_LOST_STAGE_TYPES)}) AND loss_reason IS NOT NULL)
                      ) THEN 1 ELSE 0 END AS held,
             CASE WHEN booked = 1 AND stage_type IN (${sqlIn(DQ_LOST_STAGE_TYPES)}) THEN 1 ELSE 0 END AS disqualified_lost
           FROM ds WHERE day IS NOT NULL
         )
         GROUP BY day
       )
       SELECT TO_CHAR(f.day,'YYYY-MM-DD') AS DATE,
         f.page_view, f.page_view_fb, f.page_view_organic,
         f.cta_clicked, f.cta_fb, f.cta_organic,
         f.submit_partial, f.partial_fb, f.partial_organic,
         f.submit_qualified, f.qualified_fb, f.qualified_organic,
         f.booked_all, f.booked_fb, f.booked_organic,
         -- CALL1_BOOKED mirrors the marketing BOOKING_COMPLETE event (matches Amplitude).
         -- ACCEPTED / HELD are COHORT metrics: of THIS day's Call 1 bookings, how many
         -- eventually held / were accepted (so recent days read low until they mature).
         COALESCE(s.accepted,0) AS accepted,
         COALESCE(s.accepted_fb,0) AS accepted_fb,
         COALESCE(s.accepted_organic,0) AS accepted_organic,
         COALESCE(s.no_show,0) AS no_show,
         COALESCE(s.no_show_fb,0) AS no_show_fb,
         COALESCE(s.no_show_organic,0) AS no_show_organic,
         COALESCE(s.disqualified_lost,0) AS disqualified_lost,
         COALESCE(s.held,0) AS held,
         COALESCE(s.held_fb,0) AS held_fb,
         COALESCE(s.held_organic,0) AS held_organic
       FROM f LEFT JOIN s ON f.day = s.day
       ORDER BY f.day DESC`,
      // Binds: overrides JSON, then the -days window for excluded_amps, mkt, src_raw.
      [overridesJson(bookingOverrides), -days, -days, -days]
    );

    return rows.map((r) => ({
      date: String(r.DATE),
      pageView: num(r.PAGE_VIEW),
      pageViewFb: num(r.PAGE_VIEW_FB),
      pageViewOrganic: num(r.PAGE_VIEW_ORGANIC),
      ctaClicked: num(r.CTA_CLICKED),
      ctaFb: num(r.CTA_FB),
      ctaOrganic: num(r.CTA_ORGANIC),
      submitPartial: num(r.SUBMIT_PARTIAL),
      submitPartialFb: num(r.PARTIAL_FB),
      submitPartialOrganic: num(r.PARTIAL_ORGANIC),
      submitQualified: num(r.SUBMIT_QUALIFIED),
      submitQualifiedFb: num(r.QUALIFIED_FB),
      submitQualifiedOrganic: num(r.QUALIFIED_ORGANIC),
      bookedAll: num(r.BOOKED_ALL),
      bookedFb: num(r.BOOKED_FB),
      bookedOrganic: num(r.BOOKED_ORGANIC),
      accepted: num(r.ACCEPTED),
      acceptedFb: num(r.ACCEPTED_FB),
      acceptedOrganic: num(r.ACCEPTED_ORGANIC),
      noShow: num(r.NO_SHOW),
      noShowFb: num(r.NO_SHOW_FB),
      noShowOrganic: num(r.NO_SHOW_ORGANIC),
      disqualifiedLost: num(r.DISQUALIFIED_LOST),
      held: num(r.HELD),
      heldFb: num(r.HELD_FB),
      heldOrganic: num(r.HELD_ORGANIC),
    }));
  }

  /**
   * Daily aggregate customer P&L over the *paying* customer base.
   *
   * Ties out to the internal Customer Funnel tool by matching its three choices:
   *   - EV take = `EV_OWED_USD` (Wonderly's cut, not gross EV);
   *   - Ad spend = *actual delivered* Meta spend (`TOTAL_META_SPEND_USD`), NOT the value
   *     view's `AD_SPEND_USD`, which is the daily budget (higher than what actually ran);
   *   - scope = teams whose subscription is `active` or `past_due` — the raw value view
   *     carries a dense row for every team (trials, canceled, idle non-customers) whose
   *     spend without owed-EV would otherwise drag PnL down.
   * PnL is then EV take − actual spend. It won't tie to the dollar (the tool's PnL is a
   * modeled expected value with a large uncertainty band and re-syncs daily), but the
   * scope and spend source now match.
   *
   * Note: subscription status is the team's *current* status (no point-in-time status),
   * so a recently-churned team drops out of its historical days. `AD_SPEND` here is what
   * Wonderly manages for customers, not acquisition spend.
   *
   * @param days - Trailing window to pull, e.g. 90
   * @returns One row per day, newest first
   */
  async getDailyCustomerPnl(days: number): Promise<CustomerPnlRow[]> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH ms AS (
         SELECT TEAM_ID, EVENT_DATE AS d, SUM(TOTAL_META_SPEND_USD) AS spend
         FROM ${CUSTOMER_META_SPEND_DAILY}
         WHERE EVENT_DATE >= DATEADD('day', ?, CURRENT_DATE)
         GROUP BY 1, 2
       ),
       v AS (
         SELECT TEAM_ID, METRIC_DATE AS d, SUM(EV_OWED_USD) AS ev
         FROM ${CUSTOMER_VALUE_DAILY}
         WHERE METRIC_DATE >= DATEADD('day', ?, CURRENT_DATE)
         GROUP BY 1, 2
       ),
       j AS (
         SELECT COALESCE(ms.TEAM_ID, v.TEAM_ID) AS team_id,
           COALESCE(ms.d, v.d) AS d,
           COALESCE(ms.spend, 0) AS spend,
           COALESCE(v.ev, 0) AS ev
         FROM ms FULL OUTER JOIN v ON ms.TEAM_ID = v.TEAM_ID AND ms.d = v.d
       )
       SELECT TO_CHAR(j.d,'YYYY-MM-DD') AS DATE,
         COUNT(DISTINCT CASE WHEN j.spend <> 0 OR j.ev <> 0 THEN j.team_id END) AS customers,
         ROUND(SUM(j.ev)) AS ev_take,
         ROUND(SUM(j.spend)) AS ad_spend,
         ROUND(SUM(j.ev) - SUM(j.spend)) AS pnl
       FROM j
       JOIN ${BASE_TEAMS} t ON t.WONDERLY__TEAM__ID = j.team_id
       WHERE t.WONDERLY__TEAM__SUBSCRIPTION_STATUS IN ('active','past_due')
       GROUP BY 1 ORDER BY 1 DESC`,
      [-days, -days]
    );

    return rows.map((r) => ({
      date: String(r.DATE),
      customers: num(r.CUSTOMERS),
      evTake: num(r.EV_TAKE),
      adSpend: num(r.AD_SPEND),
      pnl: num(r.PNL),
    }));
  }

  /**
   * Succeeding-contractor cohort counts, for the cost-per-succeeding-contractor KPI.
   *
   * Definition: "succeeding" = P&L > 0 — the contractor's modeled expected contribution
   * (`EV_OWED_USD`) exceeds their actual managed Meta spend (Wonderly nets positive) —
   * within 60 / 90 days of the deal being **accepted**. The clock starts at acceptance (from
   * the stage-change event); the accepted deal is linked to its prod customer team by
   * contact email → BASE__TEAMS admin email (~76% match), and ROI is measured over the
   * value view (EV) and the Meta-spend fact (spend). Only cohorts whose window has fully
   * elapsed count toward `matured*`. `cohort*` are the acceptance-date bounds of the
   * matured cohort, so the cron can attribute that window's acquisition spend.
   *
   * @returns Matured/succeeding counts and cohort acceptance windows for 60 and 90 days
   */
  async getSucceedingContractors(): Promise<SucceedingContractors> {
    const rows = await this.query<Record<string, unknown>>(
      // Accepted deals + acceptance date from the CSM_OPS CRM (current stage type quote_signed —
      // Accepted is a terminal closed_won). The acceptance date is when the deal entered the stage
      // (PIPELINE_STAGE_ENTERED_AT), falling back to CREATED_AT — the CRM has no dedicated accept
      // date (CLOSE_TIME is empty). The Amplitude stage-change events are not used.
      `WITH acc AS (
         SELECT cd.ID AS deal_id,
           COALESCE(
             CONVERT_TIMEZONE('${REPORT_TZ}', cd.PIPELINE_STAGE_ENTERED_AT)::date,
             CONVERT_TIMEZONE('${REPORT_TZ}', cd.CREATED_AT)::date
           ) AS accepted_date
         FROM AIRBYTE.CSM_OPS.CRM_DEALS cd
         JOIN AIRBYTE.CSM_OPS.CRM_PIPELINE_STAGES st
           ON st.ID = cd.PIPELINE_STAGE_ID AND st.PIPELINE_ID = '${ACQUISITION_PIPELINE_ID}'
         WHERE cd.DELETED_AT IS NULL AND st.TYPE = '${ACCEPTED_STAGE_TYPE}'
       ),
       em AS (
         SELECT cd.ID AS deal_id, LOWER(ce.EMAIL) AS email
         FROM AIRBYTE.CSM_OPS.CRM_DEALS cd
         JOIN AIRBYTE.CSM_OPS.CRM_CONTACT_EMAILS ce
           ON ce.CONTACT_ID = cd.PRIMARY_CONTACT_PERSON_ID AND ce.IS_PRIMARY
       ),
       team AS (
         SELECT acc.deal_id, MIN(acc.accepted_date) AS accepted_date, MAX(t.WONDERLY__TEAM__ID) AS team_id
         FROM acc
         JOIN em ON em.deal_id = acc.deal_id
         JOIN ${BASE_TEAMS} t ON LOWER(t.WONDERLY__TEAM__ADMIN_EMAIL) = em.email
         GROUP BY 1
       ),
       roi AS (
         SELECT tm.team_id, tm.accepted_date,
           SUM(CASE WHEN v.METRIC_DATE BETWEEN tm.accepted_date AND DATEADD('day',60,tm.accepted_date) THEN v.EV_OWED_USD ELSE 0 END) AS ev60,
           SUM(CASE WHEN ms.EVENT_DATE BETWEEN tm.accepted_date AND DATEADD('day',60,tm.accepted_date) THEN ms.TOTAL_META_SPEND_USD ELSE 0 END) AS spend60,
           SUM(CASE WHEN v.METRIC_DATE BETWEEN tm.accepted_date AND DATEADD('day',90,tm.accepted_date) THEN v.EV_OWED_USD ELSE 0 END) AS ev90,
           SUM(CASE WHEN ms.EVENT_DATE BETWEEN tm.accepted_date AND DATEADD('day',90,tm.accepted_date) THEN ms.TOTAL_META_SPEND_USD ELSE 0 END) AS spend90
         FROM team tm
         LEFT JOIN ${CUSTOMER_VALUE_DAILY} v ON v.TEAM_ID = tm.team_id
         LEFT JOIN ${CUSTOMER_META_SPEND_DAILY} ms ON ms.TEAM_ID = tm.team_id
         GROUP BY 1, 2
       )
       SELECT
         SUM(CASE WHEN accepted_date <= DATEADD('day',-60,CURRENT_DATE) THEN 1 ELSE 0 END) AS matured60,
         SUM(CASE WHEN accepted_date <= DATEADD('day',-60,CURRENT_DATE) AND (ev60 - spend60) > 0 THEN 1 ELSE 0 END) AS succeeding60,
         SUM(CASE WHEN accepted_date <= DATEADD('day',-90,CURRENT_DATE) THEN 1 ELSE 0 END) AS matured90,
         SUM(CASE WHEN accepted_date <= DATEADD('day',-90,CURRENT_DATE) AND (ev90 - spend90) > 0 THEN 1 ELSE 0 END) AS succeeding90,
         TO_CHAR(MIN(CASE WHEN accepted_date <= DATEADD('day',-60,CURRENT_DATE) THEN accepted_date END),'YYYY-MM-DD') AS cohort60_start,
         TO_CHAR(MAX(CASE WHEN accepted_date <= DATEADD('day',-60,CURRENT_DATE) THEN accepted_date END),'YYYY-MM-DD') AS cohort60_end,
         TO_CHAR(MIN(CASE WHEN accepted_date <= DATEADD('day',-90,CURRENT_DATE) THEN accepted_date END),'YYYY-MM-DD') AS cohort90_start,
         TO_CHAR(MAX(CASE WHEN accepted_date <= DATEADD('day',-90,CURRENT_DATE) THEN accepted_date END),'YYYY-MM-DD') AS cohort90_end
       FROM roi`,
      []
    );

    const r = rows[0] ?? {};

    return {
      matured60: num(r.MATURED60),
      succeeding60: num(r.SUCCEEDING60),
      matured90: num(r.MATURED90),
      succeeding90: num(r.SUCCEEDING90),
      cohort60Start: String(r.COHORT60_START ?? ''),
      cohort60End: String(r.COHORT60_END ?? ''),
      cohort90Start: String(r.COHORT90_START ?? ''),
      cohort90End: String(r.COHORT90_END ?? ''),
    };
  }

  /**
   * CAMP-side outcomes for the contractors accepted in a window — the second half of the
   * daily acquisition readout.
   *
   * Cohort membership comes from the acquisition CRM (`STG__CUSTOMER_TO_WONDERLY_DEAL`,
   * pipeline stage `Accepted`), keyed by `DEAL_CREATED_TIME` — booking the Call 1 creates the
   * deal, and that column has 100% coverage and a median 0-day gap from the booking event, so
   * it is the reliable booking-day key.
   *
   * **The join is the weak link, by construction.** The acquisition CRM and CAMP share no id,
   * so the cohort joins to a CAMP team on contractor email (deal primary contact ↔ team admin
   * email). That lands ~75%; the misses are contractors who never created a Wonderly account,
   * verified directly against prod Postgres. `matchedToCamp` therefore ships with the counts —
   * every CAMP-side number is a floor, and the caller must not present them otherwise.
   * (`DEAL_WONDERLY_PROD_EMAIL` exists on the source table and would be the better key, but is
   * entirely unpopulated today — recheck it before adding more email-matching heuristics.)
   *
   * "Succeeding" here is CAMP's own `DEAL_SCORE_CLASSIFICATION` — a team counts if it was ever
   * classified `Succeeding` in **any** lifecycle week, not merely the latest. That is what the
   * hand-built readout measured; "currently Succeeding" yields roughly a third of the count.
   * This is deliberately a different definition from `getSucceedingContractors` (P&L > 0), which
   * powers the sheet's own cost-per-succeeding row. Keep them distinct.
   *
   * @param windowStart - Cohort window start, inclusive, `YYYY-MM-DD`
   * @param windowEnd - Cohort window end, exclusive, `YYYY-MM-DD`
   * @returns One set of counts for the cohort
   */
  async getCampCohort(windowStart: string, windowEnd: string): Promise<CampCohortCounts> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH cohort AS (
         SELECT DEAL_ID, LOWER(DEAL_PRIMARY_CONTACT_EMAIL) AS email
         FROM ${CUSTOMER_TO_WONDERLY_DEAL}
         WHERE PIPELINE_STAGE_NAME = 'Accepted'
           AND DEAL_CREATED_TIME >= ? AND DEAL_CREATED_TIME < ?
           AND NOT ${excludedDealName('DEAL_NAME')}
           AND NOT ${excludedEmail('LOWER(DEAL_PRIMARY_CONTACT_EMAIL)')}
       ),
       teams AS (
         SELECT LOWER(WONDERLY__TEAM__ADMIN_EMAIL) AS email, WONDERLY__TEAM__ID AS team_id
         FROM ${BASE_TEAMS}
       ),
       -- One row per team: "ever" flags across the team's whole lifecycle, not just the
       -- latest week — a team that dipped out of Succeeding still counts as having succeeded.
       life AS (
         SELECT TEAM_ID,
           MAX(IFF(DEAL_SCORE_CLASSIFICATION = 'Succeeding', 1, 0)) AS ever_succ,
           MAX(IFF(DEAL_SCORE_CLASSIFICATION IN ('Succeeding','Okay'), 1, 0)) AS ever_okay,
           MAX(AD_FIRST_RUN_DATE) AS ad_first_run,
           SUM(DEAL_WON) AS deals_won,
           SUM(BOOKED_OWED_USD) AS booked_owed,
           SUM(COLLECTED_OWED_USD) AS collected_owed
         FROM ${LIFECYCLE_WEEKLY}
         GROUP BY TEAM_ID
       )
       SELECT COUNT(*) AS accepted,
         COUNT(t.team_id) AS matched_to_camp,
         COUNT(l.ad_first_run) AS launched_ads,
         SUM(COALESCE(l.ever_succ, 0)) AS camp_succeeding,
         SUM(COALESCE(l.ever_okay, 0)) AS camp_okay_or_succeeding,
         SUM(IFF(COALESCE(l.deals_won, 0) > 0, 1, 0)) AS won_a_job,
         SUM(IFF(COALESCE(l.booked_owed, 0) > 0, 1, 0)) AS revshare_booked,
         SUM(IFF(COALESCE(l.collected_owed, 0) > 0, 1, 0)) AS revshare_collected
       FROM cohort c
       LEFT JOIN teams t ON t.email = c.email
       LEFT JOIN life l ON l.TEAM_ID = t.team_id`,
      [windowStart, windowEnd]
    );

    const r = rows[0] ?? {};

    return {
      accepted: num(r.ACCEPTED),
      matchedToCamp: num(r.MATCHED_TO_CAMP),
      launchedAds: num(r.LAUNCHED_ADS),
      campSucceeding: num(r.CAMP_SUCCEEDING),
      campOkayOrSucceeding: num(r.CAMP_OKAY_OR_SUCCEEDING),
      wonAJob: num(r.WON_A_JOB),
      revshareBooked: num(r.REVSHARE_BOOKED),
      revshareCollected: num(r.REVSHARE_COLLECTED),
    };
  }

  /**
   * Deal-level Call 1 fact table — one row per deal that entered the Call 1 funnel in the
   * last N days: booked, or (when the "Call 1 Scheduled" event was never captured) ever
   * accepted / held. So the ACCEPTED count reconciles with Daily Funnel / Daily Metrics
   * rather than dropping the ~100 accepted deals that have no booking event.
   *
   * Held and Accepted are milestones from the stage-change events (they only fire for
   * positive stages), so both stay true even after later movement — a held deal that's
   * later disqualified is `HELD=1` and `DISQUALIFIED=1`. No-show and disqualified come
   * from the current CRM stage (those transitions emit no event, so they can't be dated).
   *
   * @param days - Trailing window, e.g. 90 (keeps cohorts open ~3 months)
   * @param bookingOverrides - Manual deal_id → booked_day fills for deals missing the event
   * @returns One row per deal, newest first (by booking, else held/accepted date)
   */
  async getCall1Deals(
    days: number,
    bookingOverrides: BookingOverride[] = []
  ): Promise<Call1DealRow[]> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH ovr AS (
         SELECT value:deal_id::string AS deal_id, TRY_TO_DATE(value:booked_day::string) AS booked_day
         FROM TABLE(FLATTEN(input => PARSE_JSON(?)))
       ),
       -- Base deal set: every acquisition-pipeline deal past the lead stages — i.e. currently in a
       -- booked-implying or outcome stage (Call 1 Scheduled / Rescheduled / No Show / Pending Offer
       -- / Accepted / DQ / Lost). Keyed on the stable stage TYPE. The Amplitude stage-change events
       -- are not used at all (they don't reliably fire per stage).
       funnel_deals AS (
         SELECT cd.ID AS deal_id
         FROM AIRBYTE.CSM_OPS.CRM_DEALS cd
         JOIN AIRBYTE.CSM_OPS.CRM_PIPELINE_STAGES st ON st.ID = cd.PIPELINE_STAGE_ID
         WHERE st.PIPELINE_ID = '${ACQUISITION_PIPELINE_ID}' AND cd.DELETED_AT IS NULL
           AND st.TYPE IN (${sqlIn([...BOOKED_STAGE_TYPES, ...DQ_LOST_STAGE_TYPES])})
           -- Trailing window: keep deals created in the last N days (creation ≈ booking day).
           AND cd.CREATED_AT >= DATEADD('day', ?, CURRENT_DATE)
       ),
       em AS (
         SELECT CONTACT_ID,
           MAX(CASE WHEN IS_PRIMARY THEN EMAIL END) AS primary_email,
           MAX(EMAIL) AS any_email,
           LOWER(COALESCE(MAX(CASE WHEN IS_PRIMARY THEN EMAIL END), MAX(EMAIL))) AS join_email
         FROM AIRBYTE.CSM_OPS.CRM_CONTACT_EMAILS
         WHERE DELETED_AT IS NULL
         GROUP BY CONTACT_ID
       ),
       -- First BOOKING_COMPLETE per email (the true booking action) — bridged through the
       -- amplitude_ids that submitted the form under that email, since BOOKING_COMPLETE
       -- carries no email. Used as the primary booked_day when earlier than the CRM event.
       sub_amp AS (
         SELECT LOWER(EVENT_PROPERTIES:email::string) AS email, AMPLITUDE_ID
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE IN ('MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL','MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED')
           AND EVENT_PROPERTIES:email IS NOT NULL
         GROUP BY 1, 2
       ),
       bc_amp AS (
         SELECT AMPLITUDE_ID, MIN(CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date) AS bc
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE = 'MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE'
         GROUP BY 1
       ),
       email_bc AS (
         SELECT s.email, MIN(b.bc) AS bc FROM sub_amp s JOIN bc_amp b ON b.AMPLITUDE_ID = s.AMPLITUDE_ID GROUP BY 1
       ),
       -- CRM deal-creation day (100% coverage; booking the Call 1 creates the deal). The
       -- truest booked day, immune to the late re-book that can pollute Call 1 Scheduled.
       crt AS (
         SELECT ID AS deal_id, CONVERT_TIMEZONE('${REPORT_TZ}', CREATED_AT)::date AS created_day
         FROM AIRBYTE.CSM_OPS.CRM_DEALS
       ),
       -- Marketing source per email, from the form-submit events (which carry the
       -- email the person typed). The source can live in several places, so we fall
       -- back in order: event utm_source -> user utm_source -> initial utm_source ->
       -- the referrer domain (facebook.com etc.) -> a Facebook click id. Reading only
       -- event utm_source missed everyone whose tag was a user property or just a
       -- referrer/fbclid.
       -- Also carry the Meta campaign / ad id (utm_medium = campaign.id, utm_content =
       -- ad.id, set on the ad's click URL), so each deal can be traced to the exact ad.
       src_raw AS (
         SELECT LOWER(EVENT_PROPERTIES:email::string) AS email, EVENT_TIME,
           COALESCE(
             NULLIF(EVENT_PROPERTIES:utm_source::string,''),
             NULLIF(USER_PROPERTIES:utm_source::string,''),
             NULLIF(USER_PROPERTIES:initial_utm_source::string,''),
             CASE
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%facebook%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%facebook%'
                 OR EVENT_PROPERTIES:fbclid IS NOT NULL THEN 'facebook'
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%google%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%google%' THEN 'google'
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%yahoo%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%yahoo%' THEN 'yahoo'
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%bing%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%bing%' THEN 'bing'
             END
           ) AS source,
           COALESCE(NULLIF(EVENT_PROPERTIES:utm_medium::string,''), NULLIF(USER_PROPERTIES:utm_medium::string,'')) AS campaign_id,
           COALESCE(NULLIF(EVENT_PROPERTIES:utm_content::string,''), NULLIF(USER_PROPERTIES:utm_content::string,'')) AS ad_id
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE IN ('MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL','MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED','MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE')
           AND EVENT_PROPERTIES:email IS NOT NULL
           AND EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
       ),
       src AS (
         SELECT email,
           MAX_BY(source, CASE WHEN source IS NOT NULL THEN EVENT_TIME END) AS utm_source,
           -- Prefer the numeric Meta ids (skip organic tags like 'link_in_bio'); take the
           -- most recent such event, i.e. the ad that most recently drove this person.
           MAX_BY(campaign_id, CASE WHEN campaign_id RLIKE '[0-9]+' THEN EVENT_TIME END) AS campaign_id,
           MAX_BY(ad_id, CASE WHEN ad_id RLIKE '[0-9]+' THEN EVENT_TIME END) AS ad_id
         FROM src_raw
         GROUP BY 1
       )
       SELECT fd.deal_id AS DEAL_ID,
         COALESCE(cd.NAME,'') AS DEAL_NAME,
         TO_CHAR(COALESCE(o.booked_day, LEAST(NVL(ebc.bc, crt.created_day), NVL(crt.created_day, ebc.bc))),'YYYY-MM-DD') AS BOOKED_DAY,
         COALESCE(st.NAME,'') AS CURRENT_STAGE,
         -- Held / Accepted / No-show / DQ keyed on the CRM current stage TYPE, matching Daily
         -- Metrics. Held = booked deal that reached an offer/acceptance OR a DQ/Lost carrying a
         -- loss reason (a human post-call disposition); booked = a marketing booking signal or a
         -- stage only booked deals reach.
         CASE WHEN (o.booked_day IS NOT NULL OR ebc.bc IS NOT NULL OR st.TYPE IN (${sqlIn(BOOKED_STAGE_TYPES)}))
              AND (st.TYPE IN (${sqlIn(OFFER_STAGE_TYPES)})
                   OR (st.TYPE IN (${sqlIn(DQ_LOST_STAGE_TYPES)}) AND NULLIF(cd.LOSS_REASON_KEY,'') IS NOT NULL))
              THEN 1 ELSE 0 END AS HELD,
         CASE WHEN st.TYPE = '${ACCEPTED_STAGE_TYPE}' THEN 1 ELSE 0 END AS ACCEPTED,
         CASE WHEN st.TYPE = '${NO_SHOW_STAGE_TYPE}' THEN 1 ELSE 0 END AS NO_SHOW,
         CASE WHEN st.TYPE IN (${sqlIn(DQ_LOST_STAGE_TYPES)}) THEN 1 ELSE 0 END AS DISQUALIFIED,
         COALESCE(cd.ESTIMATED_AMOUNT,0) AS EST_AMOUNT,
         TRIM(COALESCE(ct.FIRST_NAME,'') || ' ' || COALESCE(ct.LAST_NAME,'')) AS CONTACT_NAME,
         COALESCE(ct.PHONE_NUMBER,'') AS PHONE,
         COALESCE(em.primary_email, em.any_email, '') AS EMAIL,
         COALESCE(src.utm_source,'') AS SOURCE,
         COALESCE(src.campaign_id,'') AS CAMPAIGN_ID,
         COALESCE(src.ad_id,'') AS AD_ID,
         -- Dates come from when the deal ENTERED its current stage (PIPELINE_STAGE_ENTERED_AT) —
         -- the CRM has no stage history, so only the current stage's entry is known.
         COALESCE(TO_CHAR(CASE WHEN st.TYPE IN (${sqlIn(OFFER_STAGE_TYPES)}) THEN CONVERT_TIMEZONE('${REPORT_TZ}', cd.PIPELINE_STAGE_ENTERED_AT)::date END,'YYYY-MM-DD'),'') AS HELD_DATE,
         COALESCE(TO_CHAR(CASE WHEN st.TYPE = '${ACCEPTED_STAGE_TYPE}' THEN CONVERT_TIMEZONE('${REPORT_TZ}', cd.PIPELINE_STAGE_ENTERED_AT)::date END,'YYYY-MM-DD'),'') AS ACCEPTED_DATE
       FROM funnel_deals fd
       LEFT JOIN ovr o ON o.deal_id = fd.deal_id
       LEFT JOIN AIRBYTE.CSM_OPS.CRM_DEALS cd ON cd.ID=fd.deal_id
       LEFT JOIN AIRBYTE.CSM_OPS.CRM_PIPELINE_STAGES st ON st.ID=cd.PIPELINE_STAGE_ID
       LEFT JOIN AIRBYTE.CSM_OPS.CRM_CONTACTS ct ON ct.ID=cd.PRIMARY_CONTACT_PERSON_ID
       LEFT JOIN em ON em.CONTACT_ID=cd.PRIMARY_CONTACT_PERSON_ID
       LEFT JOIN crt ON crt.deal_id=fd.deal_id
       LEFT JOIN email_bc ebc ON ebc.email=em.join_email
       LEFT JOIN src ON src.email=em.join_email
       -- Keep only genuinely BOOKED deals (this is a Call-1 audit): a booked-implying stage, or a
       -- DQ/Lost that actually reached a call — a marketing BOOKING_COMPLETE, a manual override, or
       -- a loss reason (post-call disposition). This drops the thousands of pre-call junk leads
       -- that get auto-DQ'd without ever booking a Call 1.
       WHERE (em.join_email IS NULL OR NOT ${excludedEmail('em.join_email')})
         AND NOT ${excludedDealName('cd.NAME')}
         AND (
           st.TYPE IN (${sqlIn(BOOKED_STAGE_TYPES)})
           OR o.booked_day IS NOT NULL OR ebc.bc IS NOT NULL OR NULLIF(cd.LOSS_REASON_KEY,'') IS NOT NULL
         )
       ORDER BY COALESCE(o.booked_day, LEAST(NVL(ebc.bc, crt.created_day), NVL(crt.created_day, ebc.bc))) DESC`,
      // Binds: overrides JSON, the -days window for funnel_deals, then for src_raw.
      [overridesJson(bookingOverrides), -days, -days]
    );

    return rows.map((r) => ({
      dealId: String(r.DEAL_ID),
      dealName: String(r.DEAL_NAME ?? ''),
      bookedDay: String(r.BOOKED_DAY),
      currentStage: String(r.CURRENT_STAGE),
      held: num(r.HELD),
      accepted: num(r.ACCEPTED),
      noShow: num(r.NO_SHOW),
      disqualified: num(r.DISQUALIFIED),
      estAmount: num(r.EST_AMOUNT),
      contactName: String(r.CONTACT_NAME ?? ''),
      phone: String(r.PHONE ?? ''),
      email: String(r.EMAIL ?? ''),
      source: String(r.SOURCE ?? ''),
      campaignId: String(r.CAMPAIGN_ID ?? ''),
      adId: String(r.AD_ID ?? ''),
      heldDate: String(r.HELD_DATE ?? ''),
      acceptedDate: String(r.ACCEPTED_DATE ?? ''),
    }));
  }

  /** Close the connection. Safe to call even if never connected. */
  async close(): Promise<void> {
    if (!this.conn) return;

    const connection = this.conn;

    this.conn = null;
    await new Promise<void>((resolve) => {
      connection.destroy(() => resolve());
    });
  }
}

function num(value: unknown): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
