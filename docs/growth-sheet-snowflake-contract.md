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

### 1b. Sales pipeline event — no longer used

The `WONDERLY_SALES__DEAL__STAGE_CHANGE` event is **not used at all** anymore. It fires for too
few stages to be reliable, so held / no-show / accepted / booked and the acceptance date all come
from the `AIRBYTE.CSM_OPS.*` CRM (sections 2–3). Nothing in the sheet depends on this event.

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

The sales stage-change event carries no required properties for the sheet — it isn't used (§1b).
All sales outcomes come from the CRM (sections 2–3).

---

## 2. CRM tables — `AIRBYTE.CSM_OPS.*` (Motion CRM via Airbyte)

**This is the live source (replaced `AIRBYTE.WONDERLY_DEV.*`).** It holds only Wonderly's own
sales CRM — one pipeline, clean stages — so stage lookups are exact. These tables provide the
current deal stage, the deal→contact→email bridge, the deal-creation day, and the loss reason.
**Do not drop columns or change the sync.**

| Table                 | Columns relied on                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CRM_DEALS`           | `ID`, `NAME`, `PIPELINE_STAGE_ID`, `PRIMARY_CONTACT_PERSON_ID`, `CREATED_AT`, `PIPELINE_STAGE_ENTERED_AT`, `LOSS_REASON_KEY` |
| `CRM_PIPELINE_STAGES` | `ID`, `NAME`, `TYPE`, `PIPELINE_ID` (see section 3 — logic keys on `TYPE`)                                                   |
| `CRM_CONTACT_EMAILS`  | `CONTACT_ID`, `EMAIL`, `IS_PRIMARY`, `DELETED_AT`                                                                            |
| `CRM_CONTACTS`        | `ID`, `FIRST_NAME`, `LAST_NAME`, `PHONE_NUMBER` (deal → contact identity)                                                    |

- `CRM_DEALS.CREATED_AT` anchors the booking cohort for booked deals. `CRM_DEALS.LOSS_REASON_KEY`
  separates real post-call losses from no-show/junk drops (it gates HELD — see section 3).
- `CRM_CONTACT_EMAILS.EMAIL` (`IS_PRIMARY` preferred) = the deal's email, bridged to marketing.

---

## 3. Pipeline stages — keyed on `TYPE`, not name

All logic keys on the stage **`TYPE`** (a stable enum), scoped to
**`PIPELINE_ID = pip_019c0568f48a7a0c8d41d87efeafadd4`**. `TYPE` survives display renames, so a
stage can be renamed freely — only changing its _type_ would break a metric. In CSM_OPS every
type below is unique within the pipeline, so the mapping is exact:

| Stage (current name) | `TYPE`                      | Used for                              |
| -------------------- | --------------------------- | ------------------------------------- |
| Call 1 Scheduled     | `meeting_scheduled`         | booked signal                         |
| Rescheduled          | `rescheduled`               | booked signal (call not yet held)     |
| No Show              | `meeting_no_show`           | **NO-SHOW**                           |
| Pending Offer Out    | `quote_and_invoice_sent`    | **HELD** (offer made)                 |
| Accepted             | `quote_signed` (closed_won) | **ACCEPTED** (terminal) + HELD        |
| DQ                   | `disqualified`              | HELD _only if_ booked + a loss reason |
| Lost                 | `lost`                      | HELD _only if_ booked + a loss reason |

**Metric definitions (cohort-keyed by booking day):**

- **NO-SHOW** = current stage type `meeting_no_show`.
- **ACCEPTED** = current stage type `quote_signed` (Accepted is a terminal closed_won stage, so
  current stage is authoritative).
- **BOOKED** = a real Call-1 signal (marketing `BOOKING_COMPLETE`, the `Call 1 Scheduled`
  stage-change event, or a manual override) **or** a current stage only booked deals reach
  (`meeting_scheduled` / `rescheduled` / `meeting_no_show` / `quote_and_invoice_sent` /
  `quote_signed`). DQ and Lost need an explicit booking signal — a deal can be disqualified
  without ever booking.
- **HELD** = a **booked** deal that either reached an offer/acceptance
  (`quote_and_invoice_sent` / `quote_signed`) **or** is `disqualified` / `lost` **with a
  `LOSS_REASON_KEY` set**. A loss reason means a human dispositioned the deal after a call; booked
  DQ/Lost with _no_ reason are no-show fallout and are **not** counted as held. (This avoids
  inflating held with no-show-then-DQ deals — held ≈ no-show, ~620 vs ~670 over the last 120d.)

> **Booking day** (the cohort key) = manual override, else the earlier of the marketing
> `BOOKING_COMPLETE` bridge and the deal's `CREATED_AT`. The **acceptance date** (for the
> succeeding-contractor P&L window) = `PIPELINE_STAGE_ENTERED_AT`, falling back to `CREATED_AT`
> (the CRM has no dedicated accept date — `CLOSE_TIME` is empty). No Amplitude stage-change events
> are involved anywhere.

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
