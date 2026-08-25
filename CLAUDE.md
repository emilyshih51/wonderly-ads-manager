# Wonderly Ads Manager — Claude Instructions

## Project Overview

Next.js 16 (React 19) application for managing Meta (Facebook) ad campaigns. Deployed on Vercel (serverless). Connects to Meta Marketing API, Slack bot, Claude AI, and Redis for automation rules.

**Production URL:** wonderly-ads-manager.vercel.app
**GitHub:** emilyshih51/wonderly-ads-manager
**Stack:** Next.js App Router · TypeScript · Tailwind CSS 4 · Zustand · Radix UI · Redis · Vitest

---

## Architecture

```
src/
├── app/
│   ├── (auth)/login/          # Public login page
│   ├── (dashboard)/           # Protected app pages (session required)
│   │   ├── dashboard/
│   │   ├── campaigns/
│   │   ├── adsets/
│   │   ├── ads/
│   │   ├── chat/
│   │   ├── automations/
│   │   └── settings/
│   └── api/
│       ├── auth/              # OAuth flows (Facebook + Slack)
│       ├── meta/              # Meta Graph API proxy routes
│       ├── slack/             # Slack bot webhook handlers
│       ├── automations/       # Automation rules engine + cron
│       └── chat/              # Claude AI chat endpoint
├── components/
│   ├── ui/                    # Reusable headless UI components (Radix-based)
│   ├── layout/                # Sidebar, header
│   ├── assistant/             # 3D AI assistant overlay (React Three Fiber)
│   └── automations/           # Automation flow node components
├── config/
│   └── env.ts                 # validateEnv() — required env var check, called from next.config.ts
├── lib/
│   ├── automation-utils.ts    # Pure functions: evaluateCondition, getResultCount, getCostPerResult
│   ├── redis.ts               # getRedisClient() — null-safe Redis connection helper
│   ├── session.ts             # Server-side session management — Redis-backed with cookie-only fallback
│   ├── slack-context.ts       # fetchAdContextData, formatContextForClaude (used by Slack bot)
│   └── utils.ts               # Shared utilities (cn, formatCurrency, etc.)
├── proxy.ts                   # Auth redirect + per-IP rate limiting (60 req/min)
├── services/
│   ├── anthropic/             # AnthropicService — Claude API wrapper
│   ├── logger/                # createLogger() — structured console logger
│   ├── meta/                  # MetaService — typed Meta Graph API wrapper + OAuth helpers
│   ├── rules-store/           # RulesStoreService — automation rules (Redis + cookie fallback)
│   └── slack/                 # SlackService — Slack Web API wrapper + OAuth helper
├── hooks/
│   └── use-chat-engine.tsx    # Shared chat logic (messages, input, send) used by /chat and assistant panel
├── stores/
│   ├── app-store.ts           # Zustand global state (datePreset, adAccountId)
│   └── assistant-store.ts     # Zustand + persist — assistantEnabled, assistantPanelOpen (localStorage)
└── types/
    └── index.ts               # All shared TypeScript types
```

---

## Code Conventions

### TypeScript

- Strict mode is on. No `any` unless interfacing with untyped third-party data.
- Use types from `src/types/index.ts` for all domain objects (campaigns, ad sets, ads, sessions, insights).
- Prefer `interface` for domain types, `type` for unions and utility types.

### JSDoc

- Add JSDoc to all exported functions and hooks in new or modified files.
- Use `@param` for each parameter and `@returns` for non-void return values.
- Do not over-document — skip obvious params like `children` or `className`. One-line summary + params/returns only.

### Imports

- Always use the `@/` alias (maps to `src/`). Never use relative imports like `../logger`.
- Group imports: external packages → internal `@/` imports → relative.

### Styling

- Tailwind CSS 4 via `@tailwindcss/postcss`.
- Use `cn()` from `@/lib/utils` for conditional class merging.
- No inline styles unless absolutely necessary for dynamic values.
- **All UI must be fully responsive.** Every page, panel, dialog, and component must work correctly on mobile (320px+) through desktop. Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) to adapt layouts. Multi-column grids should collapse to single column on mobile. Horizontal flex rows with many items should wrap or stack vertically. Drawers/panels should be full-width on mobile with `sm:max-w-*` for fixed width on desktop. Never build desktop-only UI without a mobile fallback.

### API Routes

- All routes in `src/app/api/` follow Next.js App Router conventions.
- Protected routes validate the session cookie (`getSession()` from `@/lib/session`).
- Return typed `NextResponse.json()` responses. Use appropriate HTTP status codes.
- Never log secrets or tokens. Use `createLogger()` from `@/services/logger` — never `console.*`.

### Services

All external API calls go through service classes. Never call `fetch()` directly in route files.

- **MetaService** — all Meta Graph API calls, including OAuth token exchange
- **SlackService** — all Slack Web API calls, including OAuth token exchange
- **AnthropicService** — Claude API calls
- **RulesStoreService** — automation rules persistence (Redis + cookie fallback)

### State Management

- Client state: Zustand stores at `src/stores/app-store.ts` (global) and `src/stores/assistant-store.ts` (3D assistant).
- Server state: fetched fresh on each request — no client-side caching layer.
- Sessions: Redis-backed server-side sessions (session ID in cookie, data in Redis). Falls back to cookie-only storage when `REDIS_URL` is unset (dev). Allows server-side revocation on logout.
- Rules persistence: Redis (for cron) + cookies (for UI). Both are written on every save.

---

## Security Rules

> These are non-negotiable. Do not remove or bypass any of these.

1. **Cron endpoint authentication:** `GET /api/automations/evaluate` checks `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set. In production without `CRON_SECRET` the endpoint returns 503. Do not remove this logic.

2. **Session validation:** Every protected API route must call `getSession()` and return 401 if null. Never skip this. The cron endpoint and Slack webhooks are the only exceptions (they use their own auth).

3. **Slack signature verification:** All inbound Slack webhooks must call `slack.verifySignature()` before processing. The `url_verification` challenge is the only exception.

4. **Never expose `META_SYSTEM_ACCESS_TOKEN` in client-side code** (no `NEXT_PUBLIC_` prefix, never passed to the browser).

5. **System token scope:** `META_SYSTEM_ACCESS_TOKEN` is only for the cron evaluator (`GET /api/automations/evaluate`) and Slack bot routes (`/api/slack/events`, `/api/slack/interactions`). All user-facing API routes must use `session.meta_access_token` — never fall back to the system token.

6. **Email allowlist:** `ALLOWED_EMAILS` gates Facebook login. If unset, any Facebook user can log in. Check is enforced in `/api/auth/facebook/callback/route.ts`.

7. **Slack action allowlist:** `ALLOWED_SLACK_USER_IDS` gates button-triggered actions in `/api/slack/interactions` and bot @mentions in `/api/slack/events`. If unset, any workspace member can execute actions and query the bot.

8. **Slack channel allowlist:** `ALLOWED_SLACK_CHANNEL_IDS` gates which channels the bot responds to @mentions in (`/api/slack/events`). If unset, the bot responds in any channel it's invited to.

9. **Cookie security:** Session cookie is `httpOnly: true`, `secure: true` in production, `sameSite: lax`. Do not change these settings.

---

## Environment Variables

All secrets live in Vercel environment variables. **Never commit `.env` files.**

See [`.env.example`](.env.example) for the full list of variables and their descriptions.

Required variables are validated at build time in `src/config/env.ts`. The build (and `next dev`) will throw with a clear error if any are missing. Required variables:

- `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_ACCESS_TOKEN`
- `NEXT_PUBLIC_APP_URL`
- `ANTHROPIC_API_KEY`
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

---

## Common Patterns

### Reading session in an API route

```ts
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### Calling the Meta API

```ts
import { MetaService } from '@/services/meta';

const meta = new MetaService(session.meta_access_token, session.ad_account_id);
const campaigns = await meta.getCampaigns();
const insights = await meta.getFilteredInsights('ad', { datePreset: 'last_7d' });
```

### Posting to Slack

```ts
import { SlackService } from '@/services/slack';

const slack = new SlackService(
  process.env.SLACK_BOT_TOKEN ?? '',
  process.env.SLACK_SIGNING_SECRET ?? ''
);
await slack.postMessage(channelId, 'Hello!', blocks, threadTs);
await slack.sendBudgetNotification(channelId, { entityName, newBudget, previousBudget });
```

### Saving/reading automation rules

```ts
import { RulesStoreService } from '@/services/rules-store';
import { getRedisClient } from '@/lib/redis';

const redis = await getRedisClient(); // null in dev without REDIS_URL
const store = new RulesStoreService(redis);
const activeRules = await store.getActive();
```

### Promoting ads — the `+` marker (don't break this)

The promote action (`GET /api/automations/evaluate`) duplicates a winning ad into the rule's target ad set. Whether the **original** is paused is controlled per-rule by `pause_original` (defaults to `true`; the Step 3 UI toggle is "Pause the original winning ad"). When it's off, the winner keeps running in both places.

Invariant to preserve: after a successful promote, the original ad is renamed with a leading `+ ` via `meta.updateName(entityId, addPromotedMarker(entityName))`. On every run, promote candidates whose name is already marked (`isPromotedName`) are skipped with `skipped: 'already_promoted'` **before** conditions are evaluated. This is the only thing preventing an ad from being promoted twice when `pause_original` is off and the winner still matches the rule — the scan (`getFilteredInsights`) only returns ACTIVE ads, so a paused original drops out on its own, but a running one would re-match forever without the marker. The helpers live in `src/services/meta/constants.ts` (`PROMOTED_AD_MARKER`, `isPromotedName`, `addPromotedMarker`, `stripPromotedMarker`). The rename is best-effort (wrapped in try/catch) so a Meta API error can't fail the promotion itself. If you change how ads are scanned, named, or promoted, keep this skip-and-mark behavior intact.

### Never auto-kill an ad that has converted (don't break this)

Automation rules must never turn off an ad with lifetime conversions. The product rule is simple: **lifetime ≥ 1 conversion → never killed; lifetime 0 conversions → killable.**

The guardrail lives in `evaluateRule` (`/api/automations/evaluate`) and is controlled per-rule by `protect_converters` (defaults to `true`, including for rules saved before the field existed; the Step 3 UI toggle is "Never turn off ads with conversions"). Only an explicit `false` disables it.

What it gates:

- `pause` — skipped, `skipped: 'has_lifetime_conversions'`
- `adjust_budget` **decrease** — skipped the same way. Increases are never gated.
- `promote` — **not** skipped. The winner is still duplicated into the target ad sets; only the pause of the original is suppressed (`promoted (original kept active)`). Duplicating a proven winner is desirable; killing it is not.
- `activate` and Slack notifications are never gated.

How lifetime conversions are read: the rule's own `date_preset` (e.g. `last_7d`) drives the **conditions**; protection is judged over the entity's whole history, so the engine runs a second `getFilteredInsights` at `date_preset=maximum` (`LIFETIME_DATE_PRESET`) and builds an entity-ID → conversion-count map with `buildLifetimeResultsMap`. The extra query only runs when the rule can actually kill something.

Fail-closed invariants to preserve:

1. A **failed** lifetime lookup protects everything — destructive actions are skipped with `skipped: 'lifetime_data_unavailable'`. A Meta outage must never become a wave of false kills.
2. An entity **absent** from the bulk lifetime rows is confirmed with a single-entity `getAdInsights(entityId, 'maximum')` call before being treated as zero. Absence usually means "never delivered", but it can also mean the bulk query hit its row limit — assuming zero there would kill a converter. If that single lookup also fails, the entity is protected.
3. The guardrail runs in dry-run/preview too, so the test panel reports what the cron would actually do.

Tests: `src/app/api/automations/__tests__/evaluate-guardrail.test.ts`.

### Logging

```ts
import { createLogger } from '@/services/logger';

const logger = createLogger('MyModule');
logger.info('Something happened', { detail });
logger.error('Something failed', error);
```

---

## Testing

Vitest is used for all unit tests. Test files live next to source in `__tests__/` directories.

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

Each service has a test file:

- `src/services/meta/__tests__/meta.test.ts`
- `src/services/slack/__tests__/slack.test.ts`
- `src/services/rules-store/__tests__/rules-store.test.ts`
- `src/services/anthropic/__tests__/anthropic.test.ts`
- `src/services/logger/__tests__/logger.test.ts`
- `src/lib/__tests__/automation-utils.test.ts`
- `src/app/api/automations/__tests__/evaluate-guardrail.test.ts`

### Locale completeness test

`locales/__tests__/locales.test.ts` verifies every locale file has **exactly the same keys** as `en.json` (no missing, no extras). It uses `en.json` as the source of truth and checks all other locale files against it.

**Rules:**

- `en.json` is the canonical locale — add new keys there first.
- After adding any key to `en.json`, add the translated equivalent to **all other locale files** (`de`, `es`, `fr`, `ja`, `ko`, `pt`, `zh`, `zh-TW`).
- Run `npm test -- locales` to verify before committing.

---

## Deployment

- Push to `main` → Vercel auto-deploys.
- Cron job runs every 5 minutes (configured in `vercel.json`), calls `GET /api/automations/evaluate` with `Authorization: Bearer <CRON_SECRET>`.
- Environment variables are set in Vercel Dashboard → Settings → Environment Variables.
- To monitor cron: Vercel Dashboard → Logs → filter by `requestPath:/api/automations/evaluate`.

---

## Commit Conventions

Commits are enforced by commitlint (`@commitlint/config-conventional`). The format is:

```
<type>(<scope>): <Subject starting with capital letter>
```

**Type** — must be one of: `build` `chore` `ci` `docs` `feat` `fix` `perf` `refactor` `revert` `style` `test`

**Scope** — optional, lowercase. Use the area being changed: `ui`, `api`, `auth`, `meta`, `slack`, `automations`, `chat`, `dashboard`, `deps`, etc.

**Subject** — sentence-case (first word capitalised, rest lower). Max header length: 120 chars.

Examples:

```
feat(ui): Add dark/light theme toggle to sidebar
fix(auth): Return 401 when session cookie is missing
perf(meta): Cache campaign insights for 10 minutes
refactor(automations): Extract condition evaluator into pure function
chore(deps): Upgrade next to 16.1.0
```

---

## What NOT to Do

- Do not store secrets in code, env files committed to git, or `NEXT_PUBLIC_` variables.
- Do not bypass `slack.verifySignature()` on inbound Slack webhooks.
- Do not remove `httpOnly` from session cookies.
- Do not add `any` types to domain objects — add proper types to `src/types/index.ts` instead.
- Do not create new API routes without session validation (or explicit equivalent auth).
- Do not call `fetch()` directly in route files — use the service classes.
- Do not use relative imports — always use `@/` aliases.
- Do not use `console.*` — use `createLogger()` from `@/services/logger`.
- Do not use `reactflow` for anything other than the automation flow editor.
- Do not add a second state management library — Zustand is the only one.
- Do not hardcode UI strings — always add them to `locales/en.json` (and all other locale files in `locales/`) and reference them via `useTranslations()`.

---

## Marketing Performance Sheet ("Growth Sheet")

A Google Sheet refreshed by the cron `GET /api/cron/marketing-daily` (Vercel cron, hourly). It tracks Wonderly's own contractor-acquisition funnel: **FB spend → page view → CTA → partial form → qualified form → Call 1 booked → held → accepted → succeeding customer.** The sandbox can't `git push` — after code changes, the user pushes and reruns the cron; formatting/values only appear after that.

### Data sources

- **Meta Marketing API** — spend for Wonderly's own ad account (`1403742814420018`). (The Fivetran→Snowflake spend pipe is dead; spend comes from the API and is joined to Snowflake outcomes by date.)
- **Snowflake** (`SnowflakeService`, one aggregation query per read):
  - `AMPLITUDE.AMPLITUDE.EVENTS_766268` — **marketing funnel events only** (`MARKETING_SITE__*`, carry **email**). The `WONDERLY_SALES__DEAL__STAGE_CHANGE` events are **no longer used anywhere** (they fire for too few stages to be reliable); all sales outcomes come from the CSM_OPS CRM.
  - `AIRBYTE.CSM_OPS.CRM_*` — deal/contact/stage tables for Wonderly's own sales CRM (deal→contact→email bridge, current stage, loss reason). One clean pipeline, 9 stages, each `TYPE` unique. **Replaced `AIRBYTE.WONDERLY_DEV.*`** (retired — it mixed in 1000+ contractor job pipelines). Team IDs here ≠ prod value-view team IDs.
  - `WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.*` (prod) — `INT__CUSTOMER_FUNNEL_V2_CUSTOMER_VALUE_DAILY` (EV_OWED_USD), `BASE__TEAMS` (admin email, subscription), `FCT__CUSTOMER_META_SPEND_DAILY` (actual delivered Meta spend, not budget).
- Timezone: all daily buckets cut on `America/Los_Angeles` (matches Amplitude UI).

- **Days to call** (lead time) = for the bookings made each day, the average days from booking to the scheduled Call 1 (`event_start − created_at`). From `AIRBYTE.CSM_OPS.BOOKING_LINK_INVITEES` (`lead` CTE in getDailyMarketing), stored as `leadDaysSum` + `leadBookings` so a window average is Σsum ÷ Σbookings (booking-weighted). Excludes canceled/rescheduled (a reschedule moves `event_start`) and clamps 0–120 days. Rendered as a ratio metric (like CPC) in Daily Metrics — no channel split, no w/w. Leads book ~4 days out (median 4).

### Tabs the cron writes

`wonderly_daily` (raw, merged+backfilled), `Daily Funnel`, `Daily Metrics` (Motion-style grid; Accepted group is first), `Overview` (KPI dashboard — includes cost per accepted 7d & 30d), `historical_cac` (monthly + all-time cost per accepted, cohort-keyed), `customer_pnl`, `call1_deals` (per-deal audit), `Campaign Performance` (per-campaign booked/held/accepted + spend + cost-per-accepted), `SEO Metrics` + `SEO Pages` (organic-search grid, daily + weekly, and by landing page), `Definitions` (glossary), `meta` (freshness). Input tab `booking_overrides` is **read-only to the cron**. `call1_summary` was removed (redundant; cron deletes it each run).

`call1_deals` carries a `CAMPAIGN_NAME` column (the deal's `CAMPAIGN_ID` = utm_medium resolved to its Meta display name). The cron resolves names via `MetaService.getCampaigns()` + `getCampaignSpendForDateRange` (campaign-level insights over the backfill window, which also covers archived campaigns) into a `campaignNameById` map, enriches the deals with `withCampaignNames`, then builds the `Campaign Performance` tab via `computeCampaignPerformance(namedDeals, campaignSpend)` (`src/lib/campaign-performance.ts`, pure + unit-tested). That tab counts booked/held/accepted per campaign from the deal rows (booking-day cohort, matching Daily Metrics), joins campaign-level Meta spend, and shows cost-per-accepted (same maturation caveat as `historical_cac`; blank when spend but no acceptances). Campaigns with spend but no deals still appear so wasted spend is visible. Both Meta reads are best-effort — on failure names fall back to the raw id and spend to 0.

### Key model decisions (all intentional — don't "fix" without checking)

- **Backfill anchor:** `BACKFILL_START = '2026-05-01'` (first week sales data exists). The refetch window is derived from it each run (grows over time), and every tab is floored to `>= May 1`. Don't revert to a rolling day count.
- **Channel split:** FB = `utm_source` facebook/ig OR an `fbclid`; Organic = everything else. Visible from page view on. Spend is 100% FB (Organic = 0); CPC has no split. **Sales-side `is_fb` is hybrid** (in `ds`): prefer the deal's OWN attribution written to `CRM_DEALS.METADATA:attribution` at creation (`utm_source`/`acquisition_channel`/`fbclid`, populated on new deals from ~Aug 2026), else fall back to the email→marketing-session bridge (`src`) for older deals. Coverage ramps as the CRM writes attribution on more deals; `utm_medium`/`utm_content` in the same block are Meta campaign/ad ids if we later want deal-level ad attribution.
- **SEO / channel dimension (`SEO Metrics`, `SEO Pages`):** the binary FB-vs-organic split above answers "was it paid?", not "was it SEO?" — its `*_ORGANIC` columns lump SEO, LLM referrals, partner/press referrals and direct into one bucket. `getChannelFunnel` + `getSeoLandingPages` refine that bucket with a **6-way channel ladder** (`CHANNEL_SQL` in `snowflake/index.ts`, documented in prose in `src/lib/channel.ts`): `fb` → `ai` → `seo` → `other` → `direct` → `referral`, first match wins. **The `fb` branch is byte-identical to the existing `is_fb` session rule on purpose** — that's what makes the other five an exact partition of `*_ORGANIC`, so the SEO tabs always reconcile with `wonderly_daily`. Every non-FB branch reads **first-touch** `USER_PROPERTIES:initial_utm_source` / `initial_referrer` (Amplitude `$setOnce`), not the session's utm: an SEO visitor who leaves and returns by typing the URL is still SEO, which last-touch would misfile as `direct`. Keying is unchanged from the blended tabs (sessions/CTA/partial/qualified flow-keyed; CALL1_BOOKED on the qualified day; held/no-show/accepted cohort-keyed by booking day). `SEO Metrics` is a **clone of the Daily Metrics layout** (merged group headers, live 7d avg / MTD / Prev-Month formula rows, daily rows newest-first in ISO-week blocks each closed by a shaded "Week of …" summary row, w/w heat-map) so the two tabs read identically; its per-metric group is `[Conv] Organic [w/w] Google Bing DuckDuckGo Yahoo Brave Other-engine AI-search Direct Referral Other-campaign [Unknown-source] Facebook All` where Daily Metrics has `[Cost] ALL [w/w] FB Organic` — **every channel gets a column at every funnel stage**, which is the point of the tab. `Unatt.` (a CRM deal that bridged to no marketing session) renders ONLY on the three cohort metrics (Accepted / Held / No show); on the flow metrics it would be a column of zeros, since marketing events always carry a channel. Organic resolves to the ENGINE in `CHANNEL_SQL` (google/bing/duckduckgo/yahoo/brave, else `other_engine` for the 14-person tail of Yandex/Baidu/Ecosia/Startpage); the leading **Organic** column is a derived rollup summing those engine columns, which is safe because `initial_referrer` is `$setOnce` so a person resolves to exactly one engine for life. Conv and w/w key off Organic, not off any single engine. **The `ALL` column comes from the query's own day-grain row, never from summing the channel rows** — `getChannelFunnel` emits both grains via `GROUPING SETS ((day, channel), (day))`, tagging the day-grain row `channel = 'all'`. Summing instead runs ~0.2%/day high (a person with an `fbclid` on one hit and not the next lands in two channels) and would miss the deals that bridge to no channel at all, which now carry an explicit `unattributed` label rather than being dropped. Verified: 2026-08-25 reads 774 from the `all` row vs 776 summed. The top row is **Page views** = `COUNT(DISTINCT AMPLITUDE_ID)` — people, not visits or events (organic on 2026-08-25: 69 people / 78 sessions / 131 page views) — matching `wonderly_daily.PAGE_VIEW` so the tabs reconcile. **There are deliberately no cost-per columns** — SEO has no media spend to divide by, so that leading slot carries **Conv** (this stage's SEO count ÷ the previous stage's) instead; SEO's other unit of investment is the PAGE, which is what `SEO Pages` reports (a person is credited to the **first** page they landed on, for their whole funnel; pages under 10 sessions fold into `(other pages)` unless they booked). Both reads are wrapped in one try/catch in the cron so an SEO failure can never cost the sheet its paid numbers. Since May 1 this reads: SEO 8.6k sessions → 112 booked → 16 accepted vs FB 79.6k → 1,589 → 107 — organic is ~9% of traffic and ~13% of acceptances, at a booked→accepted rate roughly 2x paid's.
- **Cost per stage:** total FB spend ÷ **ALL** (FB+organic) actions of the stage — NOT FB-only (downstream stages are weakly channel-attributed). Ratio-of-totals for the 7d/MTD/Prev summary rows; per-day = that day's spend ÷ that day's ALL count. Spend/CPC have no Cost column.
- **Summary windows are live formulas:** MTD = `>= EOMONTH(TODAY(),-1)+1 … <= TODAY()`; Prev Month = all of last month via `EOMONTH`. They self-advance (not baked-in dates). 7d avg uses the last 7 _completed_ days (skips today's partial).
- **All sales stages key on the CRM `TYPE` (stable enum), scoped to `ACQUISITION_PIPELINE_ID = pip_019c0568…`**, read from the `AIRBYTE.CSM_OPS` CRM current stage — NOT the display NAME (renames don't break metrics) and NOT the Amplitude stage-change events (they only reliably fire for Call 1 Scheduled + Accepted, so they're used **only** for the Call 1 Scheduled booking day). The CSM_OPS pipeline has 9 stages, each `TYPE` unique: `meeting_scheduled` (Call 1 Scheduled), `rescheduled`, `meeting_no_show` (No Show), `quote_and_invoice_sent` (Pending Offer Out), `quote_signed` (Accepted, closed_won), `disqualified` (DQ), `lost` (Lost). Everything is cohort-keyed by booking day (override, else earlier of BOOKING_COMPLETE email bridge / CRM `CREATED_AT`, else Call 1 Scheduled event), split FB/organic via email→utm. All live in the unified `ds`/`s` CTEs (the old `deal2`/`nsc`/`nscs` split is gone).
- **BOOKED gate** = a real Call-1 signal (marketing `BOOKING_COMPLETE`, the `Call 1 Scheduled` event, or an override) OR a current stage only booked deals reach (`meeting_scheduled`/`rescheduled`/`meeting_no_show`/`quote_and_invoice_sent`/`quote_signed`). DQ/Lost need an explicit booking signal — a deal can be DQ'd without ever booking (CSM_OPS creates a deal for every lead, so `CREATED_AT` alone no longer implies booked).
- **CALL1_BOOKED** (the headline "Call 1 booked" metric) = **a marketing-qualified lead who booked**, keyed to the day they qualified — the `qual`/`bk`/`lead` CTEs in getDailyMarketing. A lead counts only if they (a) submitted `MARKETING_SITE__BETA_FORM__SUBMIT_QUALIFIED` and (b) have a non-canceled booking in `AIRBYTE.CSM_OPS.BOOKING_LINK_INVITEES` (matched by email); it's tallied on the `SUBMIT_QUALIFIED` day, FB/organic from that event's utm. This makes Call 1 booked **a strict subset of Qualified** (the funnel can't book more than it qualified) and lines up with Meta/Amplitude — e.g. 8/10 = 15 (14 FB), vs 20 qualified. **Do NOT revert to the raw `BOOKING_LINK_INVITEES` count** (all non-canceled bookings keyed by `CREATED_AT`): that reads ~2x high (8/10 = 38) because it also counts rep-assisted / re-engaged bookings whose leads never went through the qualification form — real Call 1s, but not _marketing-funnel_ bookings. Also NOT the Amplitude `BOOKING_COMPLETE` event (it misfires). Days-to-call reuses the same qualified-and-booked cohort (call date − booking day, excl. rescheduled, clamped 0–120). The rest of the marketing funnel (page view → qualified) is Amplitude `MARKETING_SITE__*`.
- **NO_SHOW** = current stage type `meeting_no_show`, **excluding same-day dispositions** — a no-show only counts when the deal entered No Show on a LATER day than it booked (`PIPELINE_STAGE_ENTERED_AT > booked_day`; nulls kept). Calls are never booked same-day, so a deal moved to No Show the same day it booked is premature CRM data, not a real no-show (~98 dropped since May). **HELD** = a booked deal that reached an offer/acceptance (`quote_and_invoice_sent`/`quote_signed`) OR is `disqualified`/`lost` **with a `LOSS_REASON_KEY` set** (a human post-call disposition; booked DQ/Lost with no reason are no-show fallout, NOT held — this keeps held ≈ no-show instead of inflating it). **ACCEPTED** = current stage type `quote_signed` (terminal closed_won; current stage is authoritative), **deduped by contractor email** — CSM_OPS can create a second phantom "Accepted" deal for an already-accepted contractor (created straight into Accepted; `accept_rn>1` dropped), so only the earliest counts (both held and call1_deals drop the dupes too). \*\*Do NOT source held/no-show from the prod `DERIVED__CUSTOMER_FUNNEL` meeting model — that's the \_customers'\* funnel (contractors↔homeowners), a disjoint population.\*\* Over the last 120d: ~172 accepted, ~622 held, ~672 no-show. Engineer-facing reference: `docs/growth-sheet-snowflake-contract.md`.
- **HELD/ACCEPTED are COHORT-keyed by booking day** (of the deals booked that day, how many eventually held/accepted) everywhere — Daily Metrics, Daily Funnel, historical_cac, AND the Overview (headline cost-per-accepted 7d/30d + week-over-week HELD/ACCEPTED). Recent windows read low/$0 until the cohort matures; the 30d and historical_cac are the matured figures. The rest of the funnel (page views → booked) is flow-keyed by event date. Keep the Overview consistent with Daily Metrics — don't flow-key held/accepted there.
- **booked_day derivation** (per deal, in `deal2`/getCall1Deals): the **earliest booking signal** — first `BOOKING_COMPLETE` (bridged email→amplitude_id, since the event carries no email) or the **CRM deal-creation day** (`CRM_DEALS.CREATED_AT`; booking the Call 1 creates the deal), whichever is earlier — falling back to the `Call 1 Scheduled` stage event, with the `booking_overrides` tab winning over all. CREATED_AT has **100% coverage** and matches BOOKING_COMPLETE (median 0 days), so every deal gets a booked day (no deal needs a manual override anymore). The `Call 1 Scheduled` event alone is unreliable — it's often a late re-book (created day / booking_complete is earlier in ~209 deals). `booking_overrides` remains available to correct any specific deal.
- **`booking_overrides` tab** (`DEAL_ID`, `BOOKED_DAY`): manual booking-day fills for deals whose Call 1 Scheduled event was never captured (~103 accepted deals came in outbound/manual/pre-tracking). The cron reads it (seeds the header once, never overwrites), injects it into `getDailyMarketing`/`getCall1Deals` via a `PARSE_JSON(?)` CTE (single bound param — injection-safe), and `COALESCE(override, event_booked_day)` so the **override wins** — it corrects wrong/late "Call 1 Scheduled" events (e.g. a re-book after acceptance), not just fills blanks. Editing `call1_deals`/`wonderly_daily` directly is futile — the cron rewrites them every run.
- **Succeeding contractor** = **P&L > 0** (EV_OWED > the contractor's managed Meta spend) within 60/90 days of acceptance. Accepted deals + the acceptance date come from the CSM_OPS CRM (`getSucceedingContractors`: current stage `quote_signed`; accept date = `PIPELINE_STAGE_ENTERED_AT`, else `CREATED_AT` — the CRM has no dedicated accept date, `CLOSE_TIME` is empty; ~61% have the stage-entered date so the rest use creation day, a rougher window start). Cost per succeeding = FB acquisition spend over the cohort's acceptance window ÷ succeeding; `MIN_SUCCEEDING = 5` low-n guard shows a "maturing — s/m …" string below that. Data is young (acceptances start ~May 8) so both rows are still maturing.
- **customer_pnl** = EV_OWED − **actual** Meta spend (FCT\_\_…META_SPEND, not the value-view budget), paying customers only (subscription active/past_due). Matches the internal "Customer Funnel" tool. EV is forward-looking so daily PnL is lumpy.
- **call1_deals** = one row per **genuinely-booked** deal: in a booked-implying stage (Call 1 Scheduled/Rescheduled/No Show/Pending Offer/Accepted — only booked deals reach these) OR with a real booking signal (marketing `BOOKING_COMPLETE` / override). DQ/Lost qualify ONLY via a booking signal — a loss reason alone is NOT proof of booking (reps DQ leads pre-call with reasons like `wrong_fit`/`too_small_cant_scale`), so those never-booked leads are excluded. Carries **CAMPAIGN_ID / AD_ID** = Meta `utm_medium` / `utm_content` from the lead/booking events (most-recent numeric id), matched by email — for ranking ads by qualified/accepted yield.

### Identity / double-counting

Marketing events are keyed by **email** (anonymous before submit); sales events by **deal_id**; bridged deal→contact→email. One person can span multiple `amplitude_id`s (~9% inflate the marketing partial/qualified counts, which use `COUNT(DISTINCT AMPLITUDE_ID)`). **ACCEPTED is not double-counted** — it's keyed on deal_id (144 accepted deals = 144 emails). `BOOKING_COMPLETE` carries no email, so bookings can't be email-deduped.

### Test / internal exclusion (matches the Amplitude charts)

The Amplitude funnel charts exclude four email-rule cohorts, so the sheet replicates them in SQL (`excludedEmail()` in `SnowflakeService`): **Test Accounts** (email contains `test`/`wonderly`/`motion`/`tanya`), **Internal Wonderly** (`wonderly.com`/`usemotion.com`), and **Design Partners** / **Design Partners with Ads** (a list of company substrings + exact emails). Marketing funnel: excluded via `excluded_amps` (amplitude_ids whose email matches drop out of `mkt`). Sales side (no-show `nsc`, held/accepted `ds`) and `call1_deals`: excluded via the contact email (`em.join_email`). Snowflake `RLIKE` is whole-string, so substrings are wrapped `.*(…).*`. **Update the lists in `snowflake/index.ts` if the Design Partners cohorts change in Amplitude** (cohort ids urrlbtg2 / euq2js5s / ujlb6h0x / lv6hfo0w).

The sales side **also** drops QA test deals by name (`excludedDealName()`): the quote/contract pipeline generates ~22 CRM deals named `QID-<n>-<hash>-<ts>-…-Deal` that are created and "accepted" the same day and never touch the marketing funnel — so they inflate ACCEPTED/HELD but sit at booked=0 (e.g. "2 accepted, 0 booked" on a partial day). The email filter only catches the `@example.test`/`wonderly.com` ones; the null- and gmail-email QID deals leak, so `ds`/`nsc`/`getCall1Deals` add `AND NOT (LOWER(cd.NAME) RLIKE '.*(qid-[0-9]).*')` (COALESCE'd to FALSE so null-named real deals stay). Broaden the pattern if new QA-deal naming appears.

### Cron/plumbing notes

- `GoogleSheetsService.replaceRows` writes with `USER_ENTERED` (dates parse to real dates → SUMIFS date criteria work). Formatting is orthogonal (`formatTab`, idempotent) and survives value rewrites. `ensureTab`/`deleteTab` manage tab lifecycle.
- Libs are pure + unit-tested (vitest): `daily-metrics(-format)`, `daily-funnel`, `overview(-format)`, `call1-deals`, `succeeding`, `customer-pnl`, `definitions`, `marketing-daily`, `week-over-week`, `channel`, `seo-metrics(-format)`, `seo-pages`. The Snowflake SQL itself is validated ad-hoc against the live warehouse, not unit-tested.
- When touching keying/definitions, verify against Snowflake before/after and keep `Definitions` tab (`src/lib/definitions.ts`) in sync.

### Daily acquisition update (`/api/cron/acquisition-update`)

Rebuilds the "Growth — acquisition update" readout from the [Cost per Succeeding Contractor spec](https://app.notion.com/p/3b278d7150b381d2b409e20c231138a5) every morning (Vercel cron, `50 12 * * *` UTC ≈ 8:50am ET) and publishes it two ways. Reads live (Meta + Snowflake) — it does **not** read the sheet.

- **Notion:** a dated page (`Growth — acquisition update <date>`) inside a **`Growth report`** container page under the spec, so the spec gains one child instead of one per day. The container is found-or-created each run via `ensureChildPage` (idempotent — created on the first run, reused after).
- **Slack:** a 5-line TL;DR to `SLACK_GROWTH_CHANNEL` (default `#emily-space`) — north-star vs goal, the funnel in one line, cohort + match rate, and a link to the Notion page. Keep it short on purpose; the tables and caveats live in Notion.

- `src/lib/acquisition-update.ts` — pure + unit-tested: `cohortWindow`, `windowTotals`, `computeAcquisitionUpdate` (the four tables), `toSlackSummary`.
- `SnowflakeService.getCampCohort(start, end)` — the CAMP half.
- `src/services/notion/index.ts` — ~150-line Notion client (one endpoint, `POST /v1/pages`). Not the official SDK on purpose; swap to `@notionhq/client` if Notion usage grows.
- Both publish steps are best-effort: a missing `NOTION_TOKEN` or a Slack failure degrades the run to "computed but not published" and the full readout still returns in the response body.

**Key model decisions (all intentional):**

- **Rolling lagged cohort:** contractors accepted in `[T−35d, T−14d)` — 3 weeks, held back 14 days so the booking-day cohort has converted. Slides daily, stays comparable. Don't shorten the lag to make the number "current" — it will just read high.
- **`getCampCohort` "Succeeding" ≠ `getSucceedingContractors` "succeeding".** This one is CAMP's own `DEAL_SCORE_CLASSIFICATION` (Succeeding / Okay / Not Good / Failing) and counts a team that was **ever** classified `Succeeding` in any lifecycle week. `getSucceedingContractors` is P&L > 0 within 60/90 days and powers the sheet's own row. Two different questions — keep both.
  - "Ever Succeeding" is what reconciles to the hand-built readout (14 vs its 15 on the July 1–21 cohort). "Currently Succeeding" gives ~5 — about a third.
- **The cross-system join is the weak link.** The acquisition CRM and CAMP share no id, so `getCampCohort` joins deal primary-contact email → `BASE__TEAMS.WONDERLY__TEAM__ADMIN_EMAIL`. That lands ~75% (27/36 on July 1–21); the 9 misses have **no Wonderly account at all** (verified against prod Postgres — not a matching artifact). So `matchedToCamp` ships with every readout and **all CAMP counts are floors**. `STG__CUSTOMER_TO_WONDERLY_DEAL.DEAL_WONDERLY_PROD_EMAIL` would be the better key but is entirely null today — recheck it before adding email heuristics.
- **Acquisition cost = total FB spend over the cohort window.** This deliberately does **not** reproduce the hand-built 2026-08-06 readout's `~$78,900` for July 1–21: actual spend those days is `$112,667` and the booking-day accepted count is 40 (not 35), so that readout's per-contractor attribution couldn't be reconstructed from Meta or Snowflake. The window-total basis is reproducible and matches `historical_cac`.
- **Low-n guard:** below `MIN_SUCCEEDING = 5` the cost-per-succeeding cell reads `maturing — n/m` instead of a noisy dollar figure.
- Caveats (match rate, attribution difference, cohort maturity, near-zero collected) are generated into the output — they are part of the readout, not commentary. Don't strip them.

### Read-only MCP server (`/api/mcp`)

A hosted, streamable-HTTP MCP that exposes the same Growth intelligence as tools for any MCP client (endpoint `POST /api/mcp/mcp`). **Read-only** — no writes, no ad changes, no sheet mutation. Node runtime, `maxDuration 60`.

- **Auth = OAuth 2.1** (Claude's connector only supports OAuth, not a bearer header). A minimal authorization server lives at `/api/oauth/*` (`src/lib/mcp-oauth.ts` + routes: `register` DCR, `authorize`, `token`, `protected-resource` + `authorization-server` metadata served at `/.well-known/*` via `next.config.ts` rewrites). Public clients + PKCE (no client secret); the **user** is gated by the app's existing session (`getSession`) — only someone logged into the dashboard can authorize; codes/tokens live in **Redis**. Requires `NEXT_PUBLIC_APP_URL` + `REDIS_URL`. A static `MCP_TOKEN` bearer is also accepted for header-capable clients (Claude Code). The MCP returns 401 + `WWW-Authenticate: …resource_metadata=…` when unauthenticated, which starts the flow.

- `src/app/api/mcp/[transport]/route.ts` — `mcp-handler` + `zod` tools: `growth_overview`, `daily_funnel`, `historical_cac`, `call1_deals` (filterable by status/campaign/ad/booked-after), `ad_performance` (rank ads by booked→held→accepted), `customer_pnl`.
- `src/lib/growth-data.ts` — `fetchGrowthData({ rows?, deals?, succeeding?, pnl? })` reads Meta + Snowflake live (mirrors the cron, minus the sheet merge/overrides) and returns typed objects; `adPerformance(deals)` aggregates by ad.
- `src/lib/growth-config.ts` — shared `BACKFILL_START`, `WONDERLY_AD_ACCOUNT_ID`, `isoDate`, `daysSince` (imported by both the cron and the MCP so they never drift).
- Deps: `mcp-handler`, `zod`. Tools reuse the same pure libs (`computeOverview`, `toDailyFunnelValues`, `toHistoricalCacValues`) so definitions stay identical to the sheet.
