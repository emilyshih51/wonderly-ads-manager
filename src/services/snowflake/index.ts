/**
 * SnowflakeService — reads the daily marketing funnel from the Snowflake data share.
 *
 * Wonderly's Amplitude events land in `AMPLITUDE.AMPLITUDE.EVENTS_766268`, and the
 * sales pipeline in the same table under `WONDERLY_SALES__DEAL__STAGE_CHANGE`. This
 * service runs ONE aggregation query per cron run: Snowflake does the counting over
 * ~10M rows and returns ~35 daily rows, so the app never moves raw events around.
 *
 * Meta spend is NOT read here — it comes from the Meta Marketing API (the
 * Facebook → Fivetran connector that would land spend in Snowflake is dead). The
 * cron joins spend to these outcomes by date.
 */

import snowflake, { type Connection } from 'snowflake-sdk';

import type { Call1DealRow } from '@/lib/call1-deals';
import type { CustomerPnlRow } from '@/lib/customer-pnl';
import type { SucceedingContractors } from '@/lib/succeeding';
import type { DailyMarketingRow } from '@/lib/marketing-daily';

/** wonderly-prod events table. The name embeds the Amplitude project id. */
const EVENTS_TABLE = 'AMPLITUDE.AMPLITUDE.EVENTS_766268';

/**
 * Timezone the daily buckets are cut on. Amplitude events land in UTC, but the
 * Amplitude UI (and how the team reads these numbers) is in the project's timezone.
 * Bucketing on UTC pushes a US-evening booking into the next calendar day, so the
 * sheet would read higher than Amplitude on the current day. Grouping by this tz
 * makes every day line up with Amplitude. Change this if the project timezone changes.
 */
const REPORT_TZ = 'America/Los_Angeles';

/** Data-team-owned view: one row per customer per day of funnel value + P&L. */
const CUSTOMER_VALUE_DAILY =
  'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.INT__CUSTOMER_FUNNEL_V2_CUSTOMER_VALUE_DAILY';

/** Prod teams dimension — 1:1 with the value view's teams, carries the ad go-live date. */
const BASE_TEAMS = 'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.BASE__TEAMS';

/** Actual delivered Meta spend per customer per day (the value view's AD_SPEND is budget). */
const CUSTOMER_META_SPEND_DAILY =
  'WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.FCT__CUSTOMER_META_SPEND_DAILY';

interface SnowflakeConfig {
  account: string;
  username: string;
  password: string;
  warehouse?: string;
  role?: string;
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
   * Sales stages come from `WONDERLY_SALES__DEAL__STAGE_CHANGE`; those are logged
   * by the sales rep so they're counted as events (not distinct prospects).
   *
   * @param days - Trailing window to pull, e.g. 35
   * @returns One row per day, newest first
   */
  async getDailyMarketing(days: number): Promise<DailyMarketingRow[]> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH mkt AS (
         -- Classify every marketing event into one source bucket by priority:
         -- 1 FB, 2 Google, 3 Yahoo, 4 Bing, 5 N/A (unattributed). Uses the session's
         -- utm_source / fbclid and, as a fallback, the referrer domain.
         SELECT CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date AS day, EVENT_TYPE, AMPLITUDE_ID,
           CASE
             WHEN LOWER(COALESCE(EVENT_PROPERTIES:utm_source::string,'')) IN ('facebook','ig','fb','instagram')
               OR EVENT_PROPERTIES:fbclid IS NOT NULL
               OR LOWER(COALESCE(USER_PROPERTIES:initial_referrer::string, USER_PROPERTIES:referrer::string,'')) LIKE '%facebook%' THEN 1
             WHEN LOWER(COALESCE(EVENT_PROPERTIES:utm_source::string,'')) LIKE '%google%'
               OR LOWER(COALESCE(USER_PROPERTIES:initial_referrer::string, USER_PROPERTIES:referrer::string,'')) LIKE '%google%' THEN 2
             WHEN LOWER(COALESCE(EVENT_PROPERTIES:utm_source::string,'')) LIKE '%yahoo%'
               OR LOWER(COALESCE(USER_PROPERTIES:initial_referrer::string, USER_PROPERTIES:referrer::string,'')) LIKE '%yahoo%' THEN 3
             WHEN LOWER(COALESCE(EVENT_PROPERTIES:utm_source::string,'')) LIKE '%bing%'
               OR LOWER(COALESCE(USER_PROPERTIES:initial_referrer::string, USER_PROPERTIES:referrer::string,'')) LIKE '%bing%' THEN 4
             ELSE 5
           END AS bucket
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
           AND EVENT_TYPE LIKE 'MARKETING_SITE%'
       ),
       -- One bucket per person per step (best-priority source), so the five buckets
       -- partition the distinct users of each step and always sum back to ALL.
       mkt2 AS (
         SELECT day, EVENT_TYPE, AMPLITUDE_ID, MIN(bucket) AS bucket FROM mkt GROUP BY 1, 2, 3
       ),
       f AS (
         SELECT day,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' THEN AMPLITUDE_ID END) AS page_view,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' AND bucket=1 THEN AMPLITUDE_ID END) AS page_view_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' AND bucket=2 THEN AMPLITUDE_ID END) AS page_view_google,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' AND bucket=3 THEN AMPLITUDE_ID END) AS page_view_yahoo,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' AND bucket=4 THEN AMPLITUDE_ID END) AS page_view_bing,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__PAGE__VIEW' AND bucket=5 THEN AMPLITUDE_ID END) AS page_view_na,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' THEN AMPLITUDE_ID END) AS cta_clicked,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' AND bucket=1 THEN AMPLITUDE_ID END) AS cta_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' AND bucket=2 THEN AMPLITUDE_ID END) AS cta_google,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' AND bucket=3 THEN AMPLITUDE_ID END) AS cta_yahoo,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' AND bucket=4 THEN AMPLITUDE_ID END) AS cta_bing,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM_CTA__CLICKED' AND bucket=5 THEN AMPLITUDE_ID END) AS cta_na,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' THEN AMPLITUDE_ID END) AS submit_partial,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' AND bucket=1 THEN AMPLITUDE_ID END) AS partial_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' AND bucket=2 THEN AMPLITUDE_ID END) AS partial_google,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' AND bucket=3 THEN AMPLITUDE_ID END) AS partial_yahoo,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' AND bucket=4 THEN AMPLITUDE_ID END) AS partial_bing,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL' AND bucket=5 THEN AMPLITUDE_ID END) AS partial_na,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' THEN AMPLITUDE_ID END) AS submit_qualified,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' AND bucket=1 THEN AMPLITUDE_ID END) AS qualified_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' AND bucket=2 THEN AMPLITUDE_ID END) AS qualified_google,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' AND bucket=3 THEN AMPLITUDE_ID END) AS qualified_yahoo,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' AND bucket=4 THEN AMPLITUDE_ID END) AS qualified_bing,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED' AND bucket=5 THEN AMPLITUDE_ID END) AS qualified_na,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' THEN AMPLITUDE_ID END) AS booked_all,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' AND bucket=1 THEN AMPLITUDE_ID END) AS booked_fb,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' AND bucket=2 THEN AMPLITUDE_ID END) AS booked_google,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' AND bucket=3 THEN AMPLITUDE_ID END) AS booked_yahoo,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' AND bucket=4 THEN AMPLITUDE_ID END) AS booked_bing,
           COUNT(DISTINCT CASE WHEN EVENT_TYPE='MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE' AND bucket=5 THEN AMPLITUDE_ID END) AS booked_na
         FROM mkt2 GROUP BY day
       ),
       -- Sales COHORT keyed by the day each deal entered "Call 1 Scheduled" (the
       -- booking). For that day's cohort: how many of those exact leads EVER
       -- reached "Accepted" (the milestone, from the stage-change event — so it
       -- still counts even if the deal later moved on), and how many are currently
       -- a no-show ("Call Missed Several Times" in the CRM). Recent cohorts read
       -- low until they mature, which is what makes acceptance forecastable.
       deal AS (
         SELECT EVENT_PROPERTIES:deal_id::string AS deal_id,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Call 1 Scheduled' THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS booked_day,
           MAX(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted' THEN 1 ELSE 0 END) AS ever_accepted,
           -- "Held" as a milestone: the stage-change event only fires for positive stages,
           -- so ever reaching one of these means the Call 1 actually happened — and it
           -- stays true even if the deal is later disqualified.
           MAX(CASE WHEN EVENT_PROPERTIES:to_stage_name::string
                IN ('Accepted','Quote & Contract Sent','On-site Scheduled','Quote & Contract Signed')
                THEN 1 ELSE 0 END) AS ever_held,
           -- Flow dates: the day the acceptance / first held happened (for daily trends).
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted' THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS accepted_day,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string
                IN ('Accepted','Quote & Contract Sent','On-site Scheduled','Quote & Contract Signed')
                THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS held_day
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE = 'WONDERLY_SALES__DEAL__STAGE_CHANGE'
           AND EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
           AND EVENT_PROPERTIES:deal_id IS NOT NULL
         GROUP BY 1
       ),
       -- Primary email per contact, to bridge a CRM deal back to its marketing source.
       em AS (
         SELECT CONTACT_ID,
           LOWER(COALESCE(MAX(CASE WHEN IS_PRIMARY THEN EMAIL END), MAX(EMAIL))) AS join_email
         FROM AIRBYTE.WONDERLY_DEV.CRM_CONTACT_EMAILS
         WHERE DELETED_AT IS NULL
         GROUP BY CONTACT_ID
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
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%google%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%google%' THEN 'google'
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%yahoo%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%yahoo%' THEN 'yahoo'
               WHEN USER_PROPERTIES:initial_referrer::string ILIKE '%bing%'
                 OR USER_PROPERTIES:referrer::string ILIKE '%bing%' THEN 'bing'
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
       -- One row per deal with its stage-derived outcomes and a source bucket (1 FB,
       -- 2 Google, 3 Yahoo, 4 Bing, 5 N/A), so held and accepted split five ways.
       ds AS (
         SELECT d.booked_day AS day, d.ever_accepted, d.accepted_day, d.held_day,
           -- Held = the call happened: reached a post-call stage by event OR is currently
           -- in one. Independent of the current stage, so a held-then-disqualified deal
           -- stays held (and is also counted as disqualified).
           CASE WHEN d.ever_held = 1
                OR st.NAME IN ('Accepted','Reviewing Contract','On-site Scheduled','Quote & Contract Sent','Quote & Contract Signed','Won - Paid')
                THEN 1 ELSE 0 END AS held,
           CASE WHEN st.NAME = 'Call Missed Several Times' THEN 1 ELSE 0 END AS no_show,
           CASE WHEN st.NAME IN ('Disqualified or Lost','Disqualified Lead','DQ - Drip') THEN 1 ELSE 0 END AS disqualified_lost,
           CASE
             WHEN LOWER(src.utm_source) IN ('facebook','ig','fb','instagram') THEN 1
             WHEN LOWER(src.utm_source) LIKE '%google%' THEN 2
             WHEN LOWER(src.utm_source) LIKE '%yahoo%' THEN 3
             WHEN LOWER(src.utm_source) LIKE '%bing%' THEN 4
             ELSE 5
           END AS bucket
         FROM deal d
         LEFT JOIN AIRBYTE.WONDERLY_DEV.CRM_DEALS cd ON cd.ID = d.deal_id
         LEFT JOIN AIRBYTE.WONDERLY_DEV.CRM_PIPELINE_STAGES st ON st.ID = cd.PIPELINE_STAGE_ID
         LEFT JOIN em ON em.CONTACT_ID = cd.PRIMARY_CONTACT_PERSON_ID
         LEFT JOIN src ON src.email = em.join_email
         WHERE d.booked_day IS NOT NULL
       ),
       s AS (
         SELECT day,
           SUM(held) AS held,
           SUM(CASE WHEN bucket=1 THEN held ELSE 0 END) AS held_fb,
           SUM(CASE WHEN bucket=2 THEN held ELSE 0 END) AS held_google,
           SUM(CASE WHEN bucket=3 THEN held ELSE 0 END) AS held_yahoo,
           SUM(CASE WHEN bucket=4 THEN held ELSE 0 END) AS held_bing,
           SUM(CASE WHEN bucket=5 THEN held ELSE 0 END) AS held_na,
           SUM(ever_accepted) AS accepted,
           SUM(CASE WHEN bucket=1 THEN ever_accepted ELSE 0 END) AS accepted_fb,
           SUM(CASE WHEN bucket=2 THEN ever_accepted ELSE 0 END) AS accepted_google,
           SUM(CASE WHEN bucket=3 THEN ever_accepted ELSE 0 END) AS accepted_yahoo,
           SUM(CASE WHEN bucket=4 THEN ever_accepted ELSE 0 END) AS accepted_bing,
           SUM(CASE WHEN bucket=5 THEN ever_accepted ELSE 0 END) AS accepted_na,
           SUM(no_show) AS no_show,
           SUM(disqualified_lost) AS disqualified_lost
         FROM ds GROUP BY 1
       ),
       -- Flow: acceptances keyed to the day they HAPPENED (accepted_day), for trends.
       sacc AS (
         SELECT accepted_day AS day,
           COUNT(*) AS accepted_flow,
           SUM(CASE WHEN bucket=1 THEN 1 ELSE 0 END) AS accepted_flow_fb,
           SUM(CASE WHEN bucket=2 THEN 1 ELSE 0 END) AS accepted_flow_google,
           SUM(CASE WHEN bucket=3 THEN 1 ELSE 0 END) AS accepted_flow_yahoo,
           SUM(CASE WHEN bucket=4 THEN 1 ELSE 0 END) AS accepted_flow_bing,
           SUM(CASE WHEN bucket=5 THEN 1 ELSE 0 END) AS accepted_flow_na
         FROM ds WHERE accepted_day IS NOT NULL GROUP BY 1
       ),
       -- Flow: Call 1s keyed to the day they were first HELD (held_day), for trends.
       sheld AS (
         SELECT held_day AS day,
           COUNT(*) AS held_flow,
           SUM(CASE WHEN bucket=1 THEN 1 ELSE 0 END) AS held_flow_fb,
           SUM(CASE WHEN bucket=2 THEN 1 ELSE 0 END) AS held_flow_google,
           SUM(CASE WHEN bucket=3 THEN 1 ELSE 0 END) AS held_flow_yahoo,
           SUM(CASE WHEN bucket=4 THEN 1 ELSE 0 END) AS held_flow_bing,
           SUM(CASE WHEN bucket=5 THEN 1 ELSE 0 END) AS held_flow_na
         FROM ds WHERE held_day IS NOT NULL GROUP BY 1
       )
       SELECT TO_CHAR(f.day,'YYYY-MM-DD') AS DATE,
         f.page_view, f.page_view_fb, f.page_view_google, f.page_view_yahoo, f.page_view_bing, f.page_view_na,
         f.cta_clicked, f.cta_fb, f.cta_google, f.cta_yahoo, f.cta_bing, f.cta_na,
         f.submit_partial, f.partial_fb, f.partial_google, f.partial_yahoo, f.partial_bing, f.partial_na,
         f.submit_qualified, f.qualified_fb, f.qualified_google, f.qualified_yahoo, f.qualified_bing, f.qualified_na,
         f.booked_all, f.booked_fb, f.booked_google, f.booked_yahoo, f.booked_bing, f.booked_na,
         COALESCE(s.accepted,0) AS accepted,
         COALESCE(s.accepted_fb,0) AS accepted_fb, COALESCE(s.accepted_google,0) AS accepted_google,
         COALESCE(s.accepted_yahoo,0) AS accepted_yahoo, COALESCE(s.accepted_bing,0) AS accepted_bing, COALESCE(s.accepted_na,0) AS accepted_na,
         COALESCE(s.no_show,0) AS no_show,
         COALESCE(s.disqualified_lost,0) AS disqualified_lost,
         COALESCE(s.held,0) AS held,
         COALESCE(s.held_fb,0) AS held_fb, COALESCE(s.held_google,0) AS held_google,
         COALESCE(s.held_yahoo,0) AS held_yahoo, COALESCE(s.held_bing,0) AS held_bing, COALESCE(s.held_na,0) AS held_na,
         COALESCE(sacc.accepted_flow,0) AS accepted_flow,
         COALESCE(sacc.accepted_flow_fb,0) AS accepted_flow_fb, COALESCE(sacc.accepted_flow_google,0) AS accepted_flow_google,
         COALESCE(sacc.accepted_flow_yahoo,0) AS accepted_flow_yahoo, COALESCE(sacc.accepted_flow_bing,0) AS accepted_flow_bing, COALESCE(sacc.accepted_flow_na,0) AS accepted_flow_na,
         COALESCE(sheld.held_flow,0) AS held_flow,
         COALESCE(sheld.held_flow_fb,0) AS held_flow_fb, COALESCE(sheld.held_flow_google,0) AS held_flow_google,
         COALESCE(sheld.held_flow_yahoo,0) AS held_flow_yahoo, COALESCE(sheld.held_flow_bing,0) AS held_flow_bing, COALESCE(sheld.held_flow_na,0) AS held_flow_na
       FROM f
       LEFT JOIN s ON f.day = s.day
       LEFT JOIN sacc ON f.day = sacc.day
       LEFT JOIN sheld ON f.day = sheld.day
       ORDER BY f.day DESC`,
      [-days, -days, -days]
    );

    return rows.map((r) => ({
      date: String(r.DATE),
      pageView: num(r.PAGE_VIEW),
      pageViewFb: num(r.PAGE_VIEW_FB),
      pageViewGoogle: num(r.PAGE_VIEW_GOOGLE),
      pageViewYahoo: num(r.PAGE_VIEW_YAHOO),
      pageViewBing: num(r.PAGE_VIEW_BING),
      pageViewNa: num(r.PAGE_VIEW_NA),
      ctaClicked: num(r.CTA_CLICKED),
      ctaFb: num(r.CTA_FB),
      ctaGoogle: num(r.CTA_GOOGLE),
      ctaYahoo: num(r.CTA_YAHOO),
      ctaBing: num(r.CTA_BING),
      ctaNa: num(r.CTA_NA),
      submitPartial: num(r.SUBMIT_PARTIAL),
      submitPartialFb: num(r.PARTIAL_FB),
      submitPartialGoogle: num(r.PARTIAL_GOOGLE),
      submitPartialYahoo: num(r.PARTIAL_YAHOO),
      submitPartialBing: num(r.PARTIAL_BING),
      submitPartialNa: num(r.PARTIAL_NA),
      submitQualified: num(r.SUBMIT_QUALIFIED),
      submitQualifiedFb: num(r.QUALIFIED_FB),
      submitQualifiedGoogle: num(r.QUALIFIED_GOOGLE),
      submitQualifiedYahoo: num(r.QUALIFIED_YAHOO),
      submitQualifiedBing: num(r.QUALIFIED_BING),
      submitQualifiedNa: num(r.QUALIFIED_NA),
      bookedAll: num(r.BOOKED_ALL),
      bookedFb: num(r.BOOKED_FB),
      bookedGoogle: num(r.BOOKED_GOOGLE),
      bookedYahoo: num(r.BOOKED_YAHOO),
      bookedBing: num(r.BOOKED_BING),
      bookedNa: num(r.BOOKED_NA),
      accepted: num(r.ACCEPTED),
      acceptedFb: num(r.ACCEPTED_FB),
      acceptedGoogle: num(r.ACCEPTED_GOOGLE),
      acceptedYahoo: num(r.ACCEPTED_YAHOO),
      acceptedBing: num(r.ACCEPTED_BING),
      acceptedNa: num(r.ACCEPTED_NA),
      held: num(r.HELD),
      heldFb: num(r.HELD_FB),
      heldGoogle: num(r.HELD_GOOGLE),
      heldYahoo: num(r.HELD_YAHOO),
      heldBing: num(r.HELD_BING),
      heldNa: num(r.HELD_NA),
      acceptedFlow: num(r.ACCEPTED_FLOW),
      acceptedFlowFb: num(r.ACCEPTED_FLOW_FB),
      acceptedFlowGoogle: num(r.ACCEPTED_FLOW_GOOGLE),
      acceptedFlowYahoo: num(r.ACCEPTED_FLOW_YAHOO),
      acceptedFlowBing: num(r.ACCEPTED_FLOW_BING),
      acceptedFlowNa: num(r.ACCEPTED_FLOW_NA),
      heldFlow: num(r.HELD_FLOW),
      heldFlowFb: num(r.HELD_FLOW_FB),
      heldFlowGoogle: num(r.HELD_FLOW_GOOGLE),
      heldFlowYahoo: num(r.HELD_FLOW_YAHOO),
      heldFlowBing: num(r.HELD_FLOW_BING),
      heldFlowNa: num(r.HELD_FLOW_NA),
      noShow: num(r.NO_SHOW),
      disqualifiedLost: num(r.DISQUALIFIED_LOST),
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
   * Spec definition: "succeeding" = ROI ≥ 2× — the contractor's modeled expected
   * contribution (`EV_OWED_USD`) is at least twice their actual Meta spend — within
   * 60 / 90 days of the deal being **accepted**. The clock starts at acceptance (from
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
      `WITH acc AS (
         SELECT EVENT_PROPERTIES:deal_id::string AS deal_id,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted'
                THEN CONVERT_TIMEZONE('UTC','${REPORT_TZ}',EVENT_TIME)::date END) AS accepted_date
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE='WONDERLY_SALES__DEAL__STAGE_CHANGE'
           AND EVENT_TIME >= DATEADD('day',-300,CURRENT_DATE)
           AND EVENT_PROPERTIES:deal_id IS NOT NULL
         GROUP BY 1 HAVING accepted_date IS NOT NULL
       ),
       em AS (
         SELECT cd.ID AS deal_id, LOWER(ce.EMAIL) AS email
         FROM AIRBYTE.WONDERLY_DEV.CRM_DEALS cd
         JOIN AIRBYTE.WONDERLY_DEV.CRM_CONTACT_EMAILS ce
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
         SUM(CASE WHEN accepted_date <= DATEADD('day',-60,CURRENT_DATE) AND spend60 > 0 AND ev60/NULLIF(spend60,0) >= 2 THEN 1 ELSE 0 END) AS succeeding60,
         SUM(CASE WHEN accepted_date <= DATEADD('day',-90,CURRENT_DATE) THEN 1 ELSE 0 END) AS matured90,
         SUM(CASE WHEN accepted_date <= DATEADD('day',-90,CURRENT_DATE) AND spend90 > 0 AND ev90/NULLIF(spend90,0) >= 2 THEN 1 ELSE 0 END) AS succeeding90,
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
   * Deal-level Call 1 fact table — one row per deal booked in the last N days.
   *
   * Held and Accepted are milestones from the stage-change events (they only fire for
   * positive stages), so both stay true even after later movement — a held deal that's
   * later disqualified is `HELD=1` and `DISQUALIFIED=1`. No-show and disqualified come
   * from the current CRM stage (those transitions emit no event, so they can't be dated).
   *
   * @param days - Trailing window, e.g. 90 (keeps cohorts open ~3 months)
   * @returns One row per deal, newest booking first
   */
  async getCall1Deals(days: number): Promise<Call1DealRow[]> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH de AS (
         SELECT EVENT_PROPERTIES:deal_id::string AS deal_id,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Call 1 Scheduled' THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS booked_day,
           MAX(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted' THEN 1 ELSE 0 END) AS ever_accepted,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted' THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS accepted_day,
           MAX(CASE WHEN EVENT_PROPERTIES:to_stage_name::string
                IN ('Accepted','Quote & Contract Sent','On-site Scheduled','Quote & Contract Signed')
                THEN 1 ELSE 0 END) AS ever_held,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string
                IN ('Accepted','Quote & Contract Sent','On-site Scheduled','Quote & Contract Signed')
                THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS held_day
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE='WONDERLY_SALES__DEAL__STAGE_CHANGE'
           AND EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
           AND EVENT_PROPERTIES:deal_id IS NOT NULL
         GROUP BY 1
       ),
       em AS (
         SELECT CONTACT_ID,
           MAX(CASE WHEN IS_PRIMARY THEN EMAIL END) AS primary_email,
           MAX(EMAIL) AS any_email,
           LOWER(COALESCE(MAX(CASE WHEN IS_PRIMARY THEN EMAIL END), MAX(EMAIL))) AS join_email
         FROM AIRBYTE.WONDERLY_DEV.CRM_CONTACT_EMAILS
         WHERE DELETED_AT IS NULL
         GROUP BY CONTACT_ID
       ),
       -- Marketing source per email, from the form-submit events (which carry the
       -- email the person typed). The source can live in several places, so we fall
       -- back in order: event utm_source -> user utm_source -> initial utm_source ->
       -- the referrer domain (facebook.com etc.) -> a Facebook click id. Reading only
       -- event utm_source missed everyone whose tag was a user property or just a
       -- referrer/fbclid.
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
           ) AS source
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TYPE IN ('MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL','MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED')
           AND EVENT_PROPERTIES:email IS NOT NULL
           AND EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
       ),
       src AS (
         SELECT email,
           MAX_BY(source, CASE WHEN source IS NOT NULL THEN EVENT_TIME END) AS utm_source
         FROM src_raw
         GROUP BY 1
       )
       SELECT de.deal_id AS DEAL_ID,
         COALESCE(cd.NAME,'') AS DEAL_NAME,
         TO_CHAR(de.booked_day,'YYYY-MM-DD') AS BOOKED_DAY,
         COALESCE(st.NAME,'') AS CURRENT_STAGE,
         CASE WHEN de.ever_held = 1
              OR st.NAME IN ('Accepted','Reviewing Contract','On-site Scheduled','Quote & Contract Sent','Quote & Contract Signed','Won - Paid')
              THEN 1 ELSE 0 END AS HELD,
         de.ever_accepted AS ACCEPTED,
         CASE WHEN st.NAME='Call Missed Several Times' THEN 1 ELSE 0 END AS NO_SHOW,
         CASE WHEN st.NAME IN ('Disqualified or Lost','Disqualified Lead','DQ - Drip') THEN 1 ELSE 0 END AS DISQUALIFIED,
         COALESCE(cd.ESTIMATED_AMOUNT,0) AS EST_AMOUNT,
         TRIM(COALESCE(ct.FIRST_NAME,'') || ' ' || COALESCE(ct.LAST_NAME,'')) AS CONTACT_NAME,
         COALESCE(ct.PHONE_NUMBER,'') AS PHONE,
         COALESCE(em.primary_email, em.any_email, '') AS EMAIL,
         COALESCE(src.utm_source,'') AS SOURCE,
         COALESCE(TO_CHAR(de.held_day,'YYYY-MM-DD'),'') AS HELD_DATE,
         COALESCE(TO_CHAR(de.accepted_day,'YYYY-MM-DD'),'') AS ACCEPTED_DATE
       FROM de
       LEFT JOIN AIRBYTE.WONDERLY_DEV.CRM_DEALS cd ON cd.ID=de.deal_id
       LEFT JOIN AIRBYTE.WONDERLY_DEV.CRM_PIPELINE_STAGES st ON st.ID=cd.PIPELINE_STAGE_ID
       LEFT JOIN AIRBYTE.WONDERLY_DEV.CRM_CONTACTS ct ON ct.ID=cd.PRIMARY_CONTACT_PERSON_ID
       LEFT JOIN em ON em.CONTACT_ID=cd.PRIMARY_CONTACT_PERSON_ID
       LEFT JOIN src ON src.email=em.join_email
       WHERE de.booked_day IS NOT NULL
       ORDER BY de.booked_day DESC`,
      [-days, -days]
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
