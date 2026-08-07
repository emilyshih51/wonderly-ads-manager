# Growth Sheet — Snowflake data contract (DO NOT BREAK)

Everything the Marketing Performance ("Growth") sheet depends on. If any of these events stop
firing, drop a property, or a stage gets renamed, the funnel silently breaks. Values come from
`src/services/snowflake/index.ts` (the cron `/api/cron/marketing-daily`). Spend/clicks are the
only inputs **not** in Snowflake — they come from the Meta Marketing API (ad account
`1403742814420018`).

---

## 1. Amplitude events — `AMPLITUDE.AMPLITUDE.EVENTS_766268`

### 1a. Marketing funnel events (one `EVENT_TYPE` per funnel step)

| Funnel step    | `EVENT_TYPE` (must match exactly)             |
| -------------- | --------------------------------------------- |
| Page view      | `MARKETING_SITE__PAGE__VIEW`                  |
| CTA click      | `MARKETING_SITE__BETA_FORM_CTA__CLICKED`      |
| Partial form   | `MARKETING_SITE__BETA_FORM__SUBMIT_PARTIAL`   |
| Qualified form | `MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED` |
| Call 1 booked  | `MARKETING_SITE__BETA_FORM__BOOKING_COMPLETE` |

### 1b. Sales pipeline event (drives held / no-show / accepted / booking day)

| Purpose                | `EVENT_TYPE`                         |
| ---------------------- | ------------------------------------ |
| Deal stage transitions | `WONDERLY_SALES__DEAL__STAGE_CHANGE` |

### 1c. Properties that MUST keep firing on those events

**On every marketing event** (`AMPLITUDE_ID` is the count/dedup key — must be stable across a
user's whole session, page view → submit → booking, or the identity bridge falls apart):

- `AMPLITUDE_ID` — the primary key for every funnel count (`COUNT(DISTINCT AMPLITUDE_ID)`).
- `EVENT_PROPERTIES:email` — required on `SUBMIT_PARTIAL` and `SUBMIT_QUALIFIED`. This is the
  **only** link from the anonymous marketing funnel to the CRM. Booking is bridged to email
  through the shared `AMPLITUDE_ID`, so if the submit events lose email, bookings can't be
  attributed either.
- `EVENT_PROPERTIES:utm_source` and `EVENT_PROPERTIES:fbclid` — the FB-vs-Organic channel split.
  A session is "FB" if `utm_source` is `facebook`/`ig` **or** an `fbclid` is present.
- `EVENT_PROPERTIES:utm_medium` → used as **campaign_id**; `EVENT_PROPERTIES:utm_content` →
  used as **ad_id** (per-ad ranking in `call1_deals` / `ad_performance`).
- Attribution fallbacks (used when event-level utm is missing):
  `USER_PROPERTIES:utm_source`, `USER_PROPERTIES:initial_utm_source`,
  `USER_PROPERTIES:utm_medium`, `USER_PROPERTIES:utm_content`,
  `USER_PROPERTIES:initial_referrer`, `USER_PROPERTIES:referrer`.

**On the sales stage-change event** (`WONDERLY_SALES__DEAL__STAGE_CHANGE`):

- `EVENT_PROPERTIES:deal_id` — required; the key that joins to the CRM deal.
- `EVENT_PROPERTIES:to_stage_name` — the destination stage; **must exactly match** the stage
  names in section 3.
- `EVENT_TIME` — bucketed to `America/Los_Angeles` for the daily grain.

> ⚠️ Known gap engineers should be aware of: the **"Call Missed Several Times"** transition
> fires **no** stage-change event. No-shows are therefore read straight from the CRM (section 2),
> not from this event. Keep that stage name stable in the CRM.

---

## 2. Dev CRM tables — `AIRBYTE.WONDERLY_DEV.*` (Motion CRM via Airbyte)

These provide the current deal stage, the deal→contact→email bridge, and the deal-creation day
(the reliable booking-day anchor). **Do not drop columns or change the sync.**

| Table                 | Columns relied on                                                            |
| --------------------- | ---------------------------------------------------------------------------- |
| `CRM_DEALS`           | `ID`, `NAME`, `PIPELINE_STAGE_ID`, `PRIMARY_CONTACT_PERSON_ID`, `CREATED_AT` |
| `CRM_PIPELINE_STAGES` | `ID`, `NAME` (the stage strings in section 3)                                |
| `CRM_CONTACT_EMAILS`  | `CONTACT_ID`, `EMAIL`, `IS_PRIMARY`, `DELETED_AT`                            |
| `CRM_CONTACTS`        | `ID` (deal → contact for name/identity)                                      |

- `CRM_DEALS.CREATED_AT` = the booking-day anchor (100% coverage; booking a Call 1 creates the
  deal). Keep it accurate — it drives which cohort a held/no-show/accepted deal lands in.
- `CRM_CONTACT_EMAILS.EMAIL` (`IS_PRIMARY` preferred) = the deal's email, bridged to marketing.

---

## 3. Pipeline stages — how they're keyed (name vs. type)

All acquisition-pipeline logic is scoped to **`PIPELINE_ID = pip_019c0568f48a7a0c8d41d87efeafadd4`**
(Wonderly's own contractor-acquisition pipeline). `CRM_PIPELINE_STAGES` holds 1000+ _other_
pipelines (every contractor's job pipeline) that reuse these stage names, so the scope is
required — e.g. "Call Missed Several Times" matches 545 deals by name across all pipelines but
only 527 in the acquisition pipeline (18 are contractor job deals). **Don't delete or rebuild
this pipeline; its id is the anchor.**

**No-show is keyed on stage `TYPE`, not name** — `TYPE = 'meeting_no_show'` (scoped to the
pipeline). `TYPE` is a semantic enum that survives display renames, so "Call Missed Several
Times" can be renamed freely; only changing its _type_ would break it.

Everything else is still **name-matched** (their types are either generic `custom` or shared
with another stage, so type isn't a safe key). Renaming any of these silently breaks the metric
— coordinate before touching them. Case- and punctuation-sensitive:

- **Booked / booking signal:** `Call 1 Scheduled` (only referenced as the stage-change event
  `to_stage_name`; the booked _count_ comes from `BOOKING_COMPLETE`, not this stage)
- **Accepted milestone:** `Accepted` — ⚠️ there are **two** "Accepted" stages in the pipeline
  (types `meeting_finished` and a leftover `custom`); name-matching catches both. `TYPE` can't be
  used because `meeting_finished` is also "Call 2 Scheduled (yet to pay)".
- **Held / post-call stages** (any of these = the call was held):
  `Reviewing Contract`, `On-site Scheduled`, `Quote & Contract Sent`,
  `Quote & Contract Signed`, `Won - Paid`, `Churned`,
  `Disqualified or Lost`, `Disqualified Lead`, `DQ - Drip`
- **Disqualified subset** (also counted as held): `Disqualified or Lost`, `Disqualified Lead`,
  `DQ - Drip`

> Stable stage `TYPE`s available if you ever want to convert more (all unique within the
> pipeline): `meeting_scheduled`, `meeting_no_show`, `on_site_scheduled`,
> `quote_and_invoice_sent`, `quote_signed`, `lost`, `disqualified`. Avoid keying on
> `meeting_finished`, `invoice_paid`, and `custom` — those are shared or generic.

---

## 4. Prod tables — `WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.*` (money / P&L / succeeding only)

Used **only** for dollars, P&L, and the "succeeding contractor" score — **not** for the funnel
counts. (This is the _customers'_ funnel model; it must not be used for Wonderly's own
held/no-show/accepted.)

| Table                                          | Columns relied on                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `INT__CUSTOMER_FUNNEL_V2_CUSTOMER_VALUE_DAILY` | `TEAM_ID`, `METRIC_DATE`, `EV_OWED_USD`                                                    |
| `FCT__CUSTOMER_META_SPEND_DAILY`               | `TEAM_ID`, `EVENT_DATE`, `TOTAL_META_SPEND_USD` (actual delivered spend, not budget)       |
| `BASE__TEAMS`                                  | `WONDERLY__TEAM__ID`, `WONDERLY__TEAM__ADMIN_EMAIL`, `WONDERLY__TEAM__SUBSCRIPTION_STATUS` |
| `FACT__CUSTOMER_FUNNEL_V2_LIFECYCLE_WEEKLY`    | `DEAL_SCORE_CLASSIFICATION` (Succeeding / Okay / Not Good / Failing)                       |
| `STG__CUSTOMER_TO_WONDERLY_DEAL`               | `DEAL_WONDERLY_PROD_EMAIL` (better join key — currently null, not yet used)                |

The cross-system join is deal primary-contact email → `BASE__TEAMS.WONDERLY__TEAM__ADMIN_EMAIL`
(~75% match). If `STG__CUSTOMER_TO_WONDERLY_DEAL.DEAL_WONDERLY_PROD_EMAIL` ever gets populated,
that becomes the correct key.

---

## 5. The identity chain (why the properties above matter)

```
anonymous visit ──AMPLITUDE_ID──► SUBMIT_PARTIAL/QUALIFIED (carries email)
       │                                    │
       └──────── same AMPLITUDE_ID ─────────┘
                        │
                 BOOKING_COMPLETE ──(bridged by AMPLITUDE_ID)──► email
                        │
                email ──► CRM_CONTACT_EMAILS ──► CRM_DEALS (stage, created_at, deal_id)
                        │
        deal_id ──► WONDERLY_SALES__DEAL__STAGE_CHANGE (to_stage_name)
```

Break any link — a reset `AMPLITUDE_ID`, a missing `email` on the submit events, a dropped
`deal_id` or `to_stage_name`, a renamed stage — and the funnel loses the ability to connect a
click to a booked call to an accepted contractor.
