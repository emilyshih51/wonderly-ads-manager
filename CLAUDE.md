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

A Google Sheet refreshed by the cron `GET /api/cron/marketing-daily` (Vercel cron, every 3h). It tracks Wonderly's own contractor-acquisition funnel: **FB spend → page view → CTA → partial form → qualified form → Call 1 booked → held → accepted → succeeding customer.** The sandbox can't `git push` — after code changes, the user pushes and reruns the cron; formatting/values only appear after that.

### Data sources

- **Meta Marketing API** — spend for Wonderly's own ad account (`1403742814420018`). (The Fivetran→Snowflake spend pipe is dead; spend comes from the API and is joined to Snowflake outcomes by date.)
- **Snowflake** (`SnowflakeService`, one aggregation query per read):
  - `AMPLITUDE.AMPLITUDE.EVENTS_766268` — marketing funnel events (`MARKETING_SITE__*`, carry **email**, no deal_id) and the sales pipeline (`WONDERLY_SALES__DEAL__STAGE_CHANGE`, carry **deal_id**, no email).
  - `AIRBYTE.WONDERLY_DEV.CRM_*` — deal/contact/stage dev tables (deal→contact→email bridge). Dev team IDs ≠ prod value-view team IDs.
  - `WONDERLY_DATA.DERIVED__CUSTOMER_FUNNEL.*` (prod) — `INT__CUSTOMER_FUNNEL_V2_CUSTOMER_VALUE_DAILY` (EV_OWED_USD), `BASE__TEAMS` (admin email, subscription), `FCT__CUSTOMER_META_SPEND_DAILY` (actual delivered Meta spend, not budget).
- Timezone: all daily buckets cut on `America/Los_Angeles` (matches Amplitude UI).

### Tabs the cron writes

`wonderly_daily` (raw, merged+backfilled), `Daily Funnel`, `Daily Metrics` (Motion-style grid), `Overview` (KPI dashboard), `customer_pnl`, `call1_deals` (per-deal audit), `Definitions` (glossary), `meta` (freshness). Input tab `booking_overrides` is **read-only to the cron**. `call1_summary` was removed (redundant; cron deletes it each run).

### Key model decisions (all intentional — don't "fix" without checking)

- **Backfill anchor:** `BACKFILL_START = '2026-05-01'` (first week sales data exists). The refetch window is derived from it each run (grows over time), and every tab is floored to `>= May 1`. Don't revert to a rolling day count.
- **Channel split:** FB = `utm_source` facebook/ig OR an `fbclid`; Organic = everything else. Visible from page view on. Spend is 100% FB (Organic = 0); CPC has no split.
- **Cost per stage:** total FB spend ÷ **ALL** (FB+organic) actions of the stage — NOT FB-only (downstream stages are weakly channel-attributed). Ratio-of-totals for the 7d/MTD/Prev summary rows; per-day = that day's spend ÷ that day's ALL count. Spend/CPC have no Cost column.
- **Summary windows are live formulas:** MTD = `>= EOMONTH(TODAY(),-1)+1 … <= TODAY()`; Prev Month = all of last month via `EOMONTH`. They self-advance (not baked-in dates). 7d avg uses the last 7 _completed_ days (skips today's partial).
- **HELD** = deal moved _past_ "Call 1 Scheduled" to any real disposition (positive stage-change event, OR current CRM stage in Accepted/Reviewing Contract/Quote Sent/On-site/Signed/Won/Churned/Disqualified/DQ). NOT held if still in "Call 1 Scheduled" or "Call Missed Several Times" (no-show). Pipeline hygiene is poor (many held calls left in "Call 1 Scheduled"), so held undercounts real calls held.
- **ACCEPTED** = ever fired the `Accepted` event (milestone; stays true after churn/drop) OR currently in a post-acceptance stage (Accepted/Reviewing Contract/Quote Sent/On-site/Signed/Won).
- **HELD/ACCEPTED are COHORT-keyed by booking day** (of the deals booked that day, how many eventually held/accepted). Recent days read low until they mature. The rest of the funnel (page views → booked) is flow-keyed by event date.
- **booked_day derivation** (per deal, in `deal2`/getCall1Deals): the **earliest booking signal** — first `BOOKING_COMPLETE` (bridged email→amplitude_id, since the event carries no email) or the **CRM deal-creation day** (`CRM_DEALS.CREATED_AT`; booking the Call 1 creates the deal), whichever is earlier — falling back to the `Call 1 Scheduled` stage event, with the `booking_overrides` tab winning over all. CREATED_AT has **100% coverage** and matches BOOKING_COMPLETE (median 0 days), so every deal gets a booked day (no deal needs a manual override anymore). The `Call 1 Scheduled` event alone is unreliable — it's often a late re-book (created day / booking_complete is earlier in ~209 deals). `booking_overrides` remains available to correct any specific deal.
- **`booking_overrides` tab** (`DEAL_ID`, `BOOKED_DAY`): manual booking-day fills for deals whose Call 1 Scheduled event was never captured (~103 accepted deals came in outbound/manual/pre-tracking). The cron reads it (seeds the header once, never overwrites), injects it into `getDailyMarketing`/`getCall1Deals` via a `PARSE_JSON(?)` CTE (single bound param — injection-safe), and `COALESCE(override, event_booked_day)` so the **override wins** — it corrects wrong/late "Call 1 Scheduled" events (e.g. a re-book after acceptance), not just fills blanks. Editing `call1_deals`/`wonderly_daily` directly is futile — the cron rewrites them every run.
- **Succeeding contractor** = **P&L > 0** (EV_OWED > the contractor's managed Meta spend) within 60/90 days of acceptance. Cost per succeeding = FB acquisition spend over the cohort's acceptance window ÷ succeeding; `MIN_SUCCEEDING = 5` low-n guard shows a "maturing — s/m …" string below that. Data is young (acceptances start ~May 8) so both rows are still maturing.
- **customer_pnl** = EV_OWED − **actual** Meta spend (FCT\_\_…META_SPEND, not the value-view budget), paying customers only (subscription active/past_due). Matches the internal "Customer Funnel" tool. EV is forward-looking so daily PnL is lumpy.
- **call1_deals** = one row per deal that entered the funnel (booked OR accepted OR held, even without a booking event). Carries **CAMPAIGN_ID / AD_ID** = Meta `utm_medium` / `utm_content` from the lead/booking events (most-recent numeric id), matched by email — for ranking ads by qualified/accepted yield.

### Identity / double-counting

Marketing events are keyed by **email** (anonymous before submit); sales events by **deal_id**; bridged deal→contact→email. One person can span multiple `amplitude_id`s (~9% inflate the marketing partial/qualified counts, which use `COUNT(DISTINCT AMPLITUDE_ID)`). **ACCEPTED is not double-counted** — it's keyed on deal_id (144 accepted deals = 144 emails). `BOOKING_COMPLETE` carries no email, so bookings can't be email-deduped.

### Cron/plumbing notes

- `GoogleSheetsService.replaceRows` writes with `USER_ENTERED` (dates parse to real dates → SUMIFS date criteria work). Formatting is orthogonal (`formatTab`, idempotent) and survives value rewrites. `ensureTab`/`deleteTab` manage tab lifecycle.
- Libs are pure + unit-tested (vitest): `daily-metrics(-format)`, `daily-funnel`, `overview(-format)`, `call1-deals`, `succeeding`, `customer-pnl`, `definitions`, `marketing-daily`, `week-over-week`. The Snowflake SQL itself is validated ad-hoc against the live warehouse, not unit-tested.
- When touching keying/definitions, verify against Snowflake before/after and keep `Definitions` tab (`src/lib/definitions.ts`) in sync.
