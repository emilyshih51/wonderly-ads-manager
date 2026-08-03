# Scope: Rebuild `call1_deals` (and `ad_performance`) on the prod funnel

## Why

`call1_deals` — the deal‑level Call 1 fact table that powers the `call1_deals` sheet tab and
the MCP `ad_performance` (rank ads by booked → held → accepted) — is built on the **dev** CRM
(`AIRBYTE.WONDERLY_DEV.CRM_*`) with held/no‑show from CRM stage and ad attribution bridged from
marketing Amplitude events by email.

We just moved Daily Metrics / Daily Funnel / Overview **held & no‑show** to the **prod**
meeting‑outcome model (accurate attendance). `call1_deals` can't follow the same way: the prod
attendance model shares **no key** with the dev CRM — 0/559 deal‑id overlap, and only **4/982**
prod outcome emails (1/578 no‑shows) bridge to a dev CRM contact. So per‑deal held/no‑show can't
be joined in; the only path is to **re‑source the whole table from prod**.

Investigation shows that's clean: the prod `DERIVED__CUSTOMER_FUNNEL` tables are internally
consistent and self‑joining on the prod `deal_id`, and — critically — they carry **per‑deal Meta
ad attribution**, which is what `ad_performance` needs.

## What prod gives us (validated, since 2026‑05‑01)

| Need                                      | Prod source                                                                                                                                                                                                                                                            | Coverage                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Held / No‑show (by call date)             | `INT__CUSTOMER_FUNNEL_V2_MEETING_OUTCOMES` (`meeting_finished` / `meeting_no_show`)                                                                                                                                                                                    | 100% (already live for Daily Metrics)                                        |
| Meta ad attribution per deal              | `INT__CUSTOMER_CRM_DEAL_DETAILS` — `DEAL_METADATA_AD_ID / ADSET_ID / CAMPAIGN_ID / UTM_SOURCE/MEDIUM/CONTENT / FBCLID / ACQUISITION_CHANNEL / LANDING_URL`                                                                                                             | 1417/1417 deals present; **861 (61%)** have an `AD_ID` (rest organic/manual) |
| Current **stage**                         | `INT__CUSTOMER_CRM_DEAL_DETAILS` — `CRM_STAGE_NAME / CRM_STAGE_TYPE / CRM_STAGE_STATUS`, `CURRENT_STAGE_ENTERED_AT`, `STAGE_HISTORY_JSON`                                                                                                                              | 100% (live Motion CRM — same stage names as dev, better coverage)            |
| **Booking day** per deal                  | `INT__CUSTOMER_CRM_DEAL_DETAILS.DEAL_CREATED_TIME` (deal creation = Call 1 booked)                                                                                                                                                                                     | **100%** since May 1                                                         |
| Lead identity (email, name, source, form) | `FACT__CUSTOMER_FUNNEL_V2_LEAD` — `LEAD_EMAIL, DEAL_NAME, LEAD_SOURCE, SOURCE, INTAKE_FORM_RESPONSE_ID, IS_BOOKED`; email also on `DEAL_DETAILS.LEAD_EMAIL`                                                                                                            | ~69% email                                                                   |
| Scheduled call time + reschedule/cancel   | `INT__CUSTOMER_FUNNEL_V2_MEETING_BOOKINGS` — `EVENT_START, IS_CANCELED, IS_RESCHEDULED, INVITEE_EMAIL/PHONE`                                                                                                                                                           | sparse (~8%; self‑serve bookings only)                                       |
| Accepted / win                            | `INT__CUSTOMER_CRM_DEAL_DETAILS` — post‑acceptance `CRM_STAGE_TYPE` (`on_site_scheduled` / `quote_and_invoice_sent` / `quote_signed` / `invoice_paid`) and/or `DEAL_LATEST_OUTCOME`; `STAGE_HISTORY_JSON` for the milestone. Reconcile to the validated 144 in step 1. | confirm exact stage set in step 1                                            |
| Deal value ($)                            | `DEAL_DETAILS.DEAL_ESTIMATED_AMOUNT_CENTS` / `DEAL_AMOUNT`, and prod value tables for EV                                                                                                                                                                               | n/a                                                                          |

All keyed on prod `deal_id` (`dea_…`).

**Note — Cost Per Call 1 Booked and the top funnel don't use dev CRM at all.** FB spend → CPC →
page view → CTA → partial → qualified → **Call 1 booked** all come from the Meta API + Amplitude
`MARKETING_SITE__*` events (booked = `BOOKING_COMPLETE`, keyed by its event day). The prod
migration only relocates the **sales side** — stage, held/no‑show, accepted — off dev CRM.

## Target: `Call1DealRow` field mapping

- `dealId` ← prod `DEAL_ID`
- `dealName` ← `FACT_LEAD.DEAL_NAME`
- `bookedDay` ← prod booking day (see open question)
- `currentStage` ← `INT__CUSTOMER_CRM_DEAL_DETAILS` current stage
- `held` ← outcomes `meeting_finished`; `heldDate` ← that outcome `EVENT_DATE`
- `noShow` ← outcomes `meeting_no_show` and never finished
- `accepted` / `acceptedDate` ← prod accepted signal (step 1)
- `disqualified` ← outcomes `disqualified` / `lost`
- `email`, `contactName`, `phone` ← `FACT_LEAD` / bookings invitee
- `source` ← `DEAL_METADATA_UTM_SOURCE` (real channel, no email bridge needed)
- `campaignId` ← `DEAL_METADATA_CAMPAIGN_ID`; `adId` ← `DEAL_METADATA_AD_ID`
- `estAmount` ← prod value table

## Open questions / decisions

1. **Accepted signal in prod** — confirm the canonical prod "accepted" (wins table vs stage
   name vs deal outcome) and reconcile its count to the validated dev‑CRM 144. This is step 1;
   everything else is low‑risk once it's pinned.
2. **Accepted consistency (important).** If `call1_deals` accepted comes from prod but Daily
   Metrics accepted stays on dev CRM (our prior decision), the two tabs will disagree. Options:
   (a) keep `call1_deals` accepted on dev too (only held/no‑show/attribution move to prod), or
   (b) move Daily Metrics accepted to prod as well for one coherent source. Recommend deciding
   this before building — leaning (b) long‑term, since prod is the complete self‑joining source.
3. **`ad_id` ↔ Meta.** Confirm `DEAL_METADATA_AD_ID` matches the Meta ad ids used elsewhere
   (ad account `1403742814420018`, the ads MCP), so `ad_performance` ranking lines up with the
   ad manager.
4. **Booked day — RESOLVED.** Use `DEAL_DETAILS.DEAL_CREATED_TIME` (100% coverage since May 1;
   the bookings table is too sparse). `booking_overrides` becomes unnecessary (prod deal‑id ≠
   our override deal‑ids anyway, and creation‑time coverage is complete).
5. **Keying.** Held/no‑show stay flow‑keyed by call date (as in Daily Metrics); accepted stays
   cohort‑keyed by booking day. Same split‑keying caveat already documented.

## Approach (phased)

1. **Confirm accepted** (1 query set) + decide open question #2.
2. Build `getCall1DealsProd` as a **parallel** method; validate row‑for‑row against the current
   `getCall1Deals` on overlapping deals and against Daily Metrics held/no‑show totals.
3. Point `call1_deals` tab + MCP `ad_performance` / `call1_deals` tools at the prod version.
4. Update `Definitions`, `CLAUDE.md`; remove the dev‑CRM + email‑bridge code paths once green.
5. (Optional, decision #2b) migrate Daily Metrics accepted to prod for full consistency.

## Effort

Medium. The data is confirmed present and self‑consistent; the work is a new ~100‑line prod
query + field mapping + validation, not new plumbing. Main risk is the accepted definition and
the accepted‑consistency decision — both resolvable in step 1 before committing to the build.
