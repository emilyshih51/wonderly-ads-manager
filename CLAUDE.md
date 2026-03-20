# Wonderly Ads Manager — Claude Instructions

## Project Overview

Next.js 16 (React 19) application for managing Meta (Facebook) ad campaigns. Deployed on Vercel (serverless). Connects to Meta Marketing API, Slack bot, Claude AI, and Redis for automation rules.

**Production URL:** wonderly-ads-manager.vercel.app
**GitHub:** emilyshih51/wonderly-ads-manager
**Stack:** Next.js App Router · TypeScript · Tailwind CSS 4 · Zustand · Radix UI · Redis

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
├── lib/
│   ├── meta-api.ts            # Meta Graph API wrapper
│   ├── slack.ts               # Slack API + signature verification
│   ├── session.ts             # Cookie-based session management
│   ├── rules-store.ts         # Automation rules persistence (Redis + cookies)
│   └── utils.ts               # Shared utilities (cn, formatCurrency, etc.)
├── stores/
│   └── app-store.ts           # Zustand global state (datePreset, adAccountId)
└── types/
    └── index.ts               # All shared TypeScript types
```

---

## Code Conventions

### TypeScript

- Strict mode is on. No `any` unless interfacing with untyped third-party data (Meta API responses, Slack payloads).
- Use types from `src/types/index.ts` for all domain objects (campaigns, ad sets, ads, sessions).
- Prefer `interface` for domain types, `type` for unions and utility types.

### Imports

- Always use the `@/` alias (maps to `src/`).
- Group imports: external packages → internal `@/` imports → relative.

### Styling

- Tailwind CSS 4 via `@tailwindcss/postcss`.
- Use `cn()` from `@/lib/utils` for conditional class merging.
- No inline styles unless absolutely necessary for dynamic values.

### API Routes

- All routes in `src/app/api/` follow Next.js App Router conventions.
- Protected routes validate the session cookie (`getSession()` from `@/lib/session`).
- Return typed `NextResponse.json()` responses. Use appropriate HTTP status codes.
- Never log secrets or tokens to the console.

### State Management

- Client state: Zustand store at `src/stores/app-store.ts`.
- Server state: fetched fresh on each request — no client-side caching layer.
- Rules persistence: Redis (for cron) + cookies (for UI). Both are written on every save.

---

## Security Rules

> These are non-negotiable. Do not remove or bypass any of these.

1. **The cron endpoint `/api/automations/evaluate` (GET) is currently unprotected.** Any change to it must NOT remove the existing fallback logic. A Vercel cron secret header check should be added before going to production.

2. **Session validation:** Every protected API route must call `getSession()` and return 401 if null. Never skip this.

3. **Slack signature verification:** All inbound Slack webhooks must call `verifySlackSignature()` before processing. The `url_verification` challenge is the only exception.

4. **Never expose `META_SYSTEM_ACCESS_TOKEN` in client-side code** (no `NEXT_PUBLIC_` prefix, never passed to the browser).

5. **No OAuth allowlist currently exists.** Any Facebook user can log in. If adding an allowlist, check email domain or user ID in `/api/auth/facebook/callback/route.ts` after fetching `userData`.

6. **Cookie security:** Session cookie is `httpOnly`, `secure` in production, `sameSite: lax`. Do not change these settings.

---

## Known Issues (Do Not Introduce More)

| Issue                                   | Severity | Notes                                              |
| --------------------------------------- | -------- | -------------------------------------------------- |
| No login restriction (any FB user)      | Critical | Add email domain/allowlist check in OAuth callback |
| Cron endpoint unauthenticated           | Critical | Add `CRON_SECRET` header check                     |
| No Slack user-level permissions         | Critical | Any workspace member can pause/resume budgets      |
| Single system token for all accounts    | High     | One compromised token affects all accounts         |
| No data freshness checks in automations | High     | Meta reporting delays can cause false pauses       |
| No daily action cap                     | High     | Misconfigured rule could pause all active ads      |
| No server-side sessions                 | High     | Cannot remotely revoke access                      |
| No audit trail in UI                    | Medium   | History stored in Redis but not displayed          |
| No rate limiting                        | Medium   | No throttling on any endpoint                      |
| No rollback mechanism                   | Medium   | No batch-undo for automation actions               |

---

## Environment Variables

All secrets live in Vercel environment variables. **Never commit `.env` files.**

See [`.env.example`](.env.example) for the full list of required variables and their descriptions.

---

## Common Patterns

### Reading session in an API route

```ts
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // ...
}
```

### Calling the Meta API

```ts
import { metaApi } from '@/lib/meta-api';

const data = await metaApi(`/act_${adAccountId}/campaigns`, accessToken, {
  params: { fields: 'id,name,status', limit: '100' },
});
```

### Posting to Slack

```ts
import { postSlackMessage } from '@/lib/slack';

await postSlackMessage(channelId, 'Hello!', blocks, threadTs);
```

### Saving/reading automation rules

```ts
import { saveRule, getActiveRules, deleteRule } from '@/lib/rules-store';
```

---

## Deployment

- Push to `main` → Vercel auto-deploys.
- Cron job runs every 5 minutes (configured in `vercel.json`).
- Environment variables are set in Vercel Dashboard → Settings → Environment Variables.
- To monitor cron: Vercel Dashboard → Logs → filter by `requestPath:/api/automations/evaluate`.

---

## What NOT to Do

- Do not store secrets in code, env files committed to git, or `NEXT_PUBLIC_` variables.
- Do not bypass `verifySlackSignature()`.
- Do not remove `httpOnly` from session cookies.
- Do not add `any` types to domain objects — add proper types to `src/types/index.ts` instead.
- Do not create new API routes without session validation.
- Do not use `reactflow` for anything other than the automation flow editor.
- Do not add a second state management library — Zustand is the only one.
