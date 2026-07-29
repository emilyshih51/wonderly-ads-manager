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
         SELECT CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date AS day, EVENT_TYPE, AMPLITUDE_ID,
           LOWER(COALESCE(EVENT_PROPERTIES:utm_source::string,'')) AS src,
           EVENT_PROPERTIES:fbclid::string AS fbclid
         FROM ${EVENTS_TABLE}
         WHERE EVENT_TIME >= DATEADD('day', ?, CURRENT_DATE)
           AND EVENT_TYPE LIKE 'MARKETING_SITE%'
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
       -- Sales COHORT keyed by the day each deal entered "Call 1 Scheduled" (the
       -- booking). For that day's cohort: how many of those exact leads EVER
       -- reached "Accepted" (the milestone, from the stage-change event — so it
       -- still counts even if the deal later moved on), and how many are currently
       -- a no-show ("Call Missed Several Times" in the CRM). Recent cohorts read
       -- low until they mature, which is what makes acceptance forecastable.
       deal AS (
         SELECT EVENT_PROPERTIES:deal_id::string AS deal_id,
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Call 1 Scheduled' THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS booked_day,
           MAX(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted' THEN 1 ELSE 0 END) AS ever_accepted
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
       -- One row per deal with its stage-derived outcomes and a channel flag, so held
       -- and accepted can be split FB vs organic (organic = ALL − FB, i.e. every deal
       -- whose Call 1 wasn't Facebook-attributed, including the unattributed ones).
       ds AS (
         SELECT d.booked_day AS day, d.ever_accepted,
           CASE WHEN st.NAME NOT IN ('Call 1 Scheduled','Call Missed Several Times') THEN 1 ELSE 0 END AS held,
           CASE WHEN st.NAME = 'Call Missed Several Times' THEN 1 ELSE 0 END AS no_show,
           CASE WHEN st.NAME = 'Disqualified or Lost' THEN 1 ELSE 0 END AS disqualified_lost,
           CASE WHEN LOWER(src.utm_source) IN ('facebook','ig') THEN 1 ELSE 0 END AS is_fb
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
           SUM(held * is_fb) AS held_fb,
           SUM(held * (1 - is_fb)) AS held_organic,
           SUM(ever_accepted) AS accepted,
           SUM(ever_accepted * is_fb) AS accepted_fb,
           SUM(ever_accepted * (1 - is_fb)) AS accepted_organic,
           SUM(no_show) AS no_show,
           SUM(disqualified_lost) AS disqualified_lost
         FROM ds GROUP BY 1
       )
       SELECT TO_CHAR(f.day,'YYYY-MM-DD') AS DATE,
         f.page_view, f.page_view_fb, f.page_view_organic,
         f.cta_clicked, f.cta_fb, f.cta_organic,
         f.submit_partial, f.partial_fb, f.partial_organic,
         f.submit_qualified, f.qualified_fb, f.qualified_organic,
         f.booked_all, f.booked_fb, f.booked_organic,
         -- CALL1_BOOKED mirrors the marketing BOOKING_COMPLETE event (matches Amplitude).
         -- ACCEPTED / NO_SHOW stay sourced from the sales pipeline cohort, so they can
         -- exceed CALL1_BOOKED on a given day (sales books Call 1s the form never sees).
         COALESCE(s.accepted,0) AS accepted,
         COALESCE(s.accepted_fb,0) AS accepted_fb,
         COALESCE(s.accepted_organic,0) AS accepted_organic,
         COALESCE(s.no_show,0) AS no_show,
         COALESCE(s.disqualified_lost,0) AS disqualified_lost,
         COALESCE(s.held,0) AS held,
         COALESCE(s.held_fb,0) AS held_fb,
         COALESCE(s.held_organic,0) AS held_organic
       FROM f LEFT JOIN s ON f.day = s.day
       ORDER BY f.day DESC`,
      [-days, -days, -days]
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
   * A contractor's clock starts at their ad go-live (`BASE__TEAMS.AD_START_DATE`), which
   * is 1:1 with the prod value view. "Succeeding" = cumulative `PNL_USD` over the value
   * view turns positive within 60 / 90 days of that start. Only teams whose window has
   * fully elapsed count toward `matured*`, so recent cohorts don't drag the number down.
   *
   * All prod — no dev-CRM bridge — so the deal→customer link the old approach lacked is
   * simply the team dimension joining the value view on TEAM_ID.
   *
   * @returns Matured and succeeding counts for the 60- and 90-day windows
   */
  async getSucceedingContractors(): Promise<SucceedingContractors> {
    const rows = await this.query<Record<string, unknown>>(
      `WITH t AS (
         SELECT WONDERLY__TEAM__ID AS team_id, WONDERLY__TEAM__AD_START_DATE AS ad_start
         FROM ${BASE_TEAMS}
         WHERE WONDERLY__TEAM__AD_START_DATE IS NOT NULL
       ),
       p AS (
         SELECT t.team_id, t.ad_start,
           SUM(CASE WHEN v.METRIC_DATE BETWEEN t.ad_start AND DATEADD('day',60,t.ad_start) THEN v.PNL_USD ELSE 0 END) AS pnl60,
           SUM(CASE WHEN v.METRIC_DATE BETWEEN t.ad_start AND DATEADD('day',90,t.ad_start) THEN v.PNL_USD ELSE 0 END) AS pnl90
         FROM t
         JOIN ${CUSTOMER_VALUE_DAILY} v ON v.TEAM_ID = t.team_id
         GROUP BY 1, 2
       )
       SELECT
         SUM(CASE WHEN ad_start <= DATEADD('day',-60,CURRENT_DATE) THEN 1 ELSE 0 END) AS matured60,
         SUM(CASE WHEN ad_start <= DATEADD('day',-60,CURRENT_DATE) AND pnl60 > 0 THEN 1 ELSE 0 END) AS succeeding60,
         SUM(CASE WHEN ad_start <= DATEADD('day',-90,CURRENT_DATE) THEN 1 ELSE 0 END) AS matured90,
         SUM(CASE WHEN ad_start <= DATEADD('day',-90,CURRENT_DATE) AND pnl90 > 0 THEN 1 ELSE 0 END) AS succeeding90
       FROM p`,
      []
    );

    const r = rows[0] ?? {};

    return {
      matured60: num(r.MATURED60),
      succeeding60: num(r.SUCCEEDING60),
      matured90: num(r.MATURED90),
      succeeding90: num(r.SUCCEEDING90),
    };
  }

  /**
   * Deal-level Call 1 fact table — one row per deal booked in the last N days.
   *
   * Held = advanced past "Call 1 Scheduled" and not a no-show. Accepted = ever
   * reached the "Accepted" stage (from the event, so later movement doesn't undo
   * it). Current stage + amount come from the CRM snapshot.
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
           MIN(CASE WHEN EVENT_PROPERTIES:to_stage_name::string='Accepted' THEN CONVERT_TIMEZONE('UTC', '${REPORT_TZ}', EVENT_TIME)::date END) AS accepted_day
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
         CASE WHEN st.NAME NOT IN ('Call 1 Scheduled','Call Missed Several Times') THEN 1 ELSE 0 END AS HELD,
         de.ever_accepted AS ACCEPTED,
         CASE WHEN st.NAME='Call Missed Several Times' THEN 1 ELSE 0 END AS NO_SHOW,
         COALESCE(cd.ESTIMATED_AMOUNT,0) AS EST_AMOUNT,
         TRIM(COALESCE(ct.FIRST_NAME,'') || ' ' || COALESCE(ct.LAST_NAME,'')) AS CONTACT_NAME,
         COALESCE(ct.PHONE_NUMBER,'') AS PHONE,
         COALESCE(em.primary_email, em.any_email, '') AS EMAIL,
         COALESCE(src.utm_source,'') AS SOURCE,
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
      estAmount: num(r.EST_AMOUNT),
      contactName: String(r.CONTACT_NAME ?? ''),
      phone: String(r.PHONE ?? ''),
      email: String(r.EMAIL ?? ''),
      source: String(r.SOURCE ?? ''),
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
