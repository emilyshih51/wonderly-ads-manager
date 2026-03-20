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
├── stores/
│   └── app-store.ts           # Zustand global state (datePreset, adAccountId)
└── types/
    └── index.ts               # All shared TypeScript types
```

---

## Code Conventions

### TypeScript

- Strict mode is on. No `any` unless interfacing with untyped third-party data.
- Use types from `src/types/index.ts` for all domain objects (campaigns, ad sets, ads, sessions, insights).
- Prefer `interface` for domain types, `type` for unions and utility types.

### Imports

- Always use the `@/` alias (maps to `src/`). Never use relative imports like `../logger`.
- Group imports: external packages → internal `@/` imports → relative.

### Styling

- Tailwind CSS 4 via `@tailwindcss/postcss`.
- Use `cn()` from `@/lib/utils` for conditional class merging.
- No inline styles unless absolutely necessary for dynamic values.

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

- Client state: Zustand store at `src/stores/app-store.ts`.
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

7. **Slack action allowlist:** `ALLOWED_SLACK_USER_IDS` gates button-triggered actions in `/api/slack/interactions`. If unset, any workspace member can pause/resume/adjust budgets.

8. **Cookie security:** Session cookie is `httpOnly: true`, `secure: true` in production, `sameSite: lax`. Do not change these settings.

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

---

## Deployment

- Push to `main` → Vercel auto-deploys.
- Cron job runs every 5 minutes (configured in `vercel.json`), calls `GET /api/automations/evaluate` with `Authorization: Bearer <CRON_SECRET>`.
- Environment variables are set in Vercel Dashboard → Settings → Environment Variables.
- To monitor cron: Vercel Dashboard → Logs → filter by `requestPath:/api/automations/evaluate`.

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
