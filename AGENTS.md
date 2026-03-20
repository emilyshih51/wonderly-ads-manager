# Wonderly Ads Manager — Agent Instructions

> Quick reference for AI agents. Full context is in [`CLAUDE.md`](./CLAUDE.md).

## What This Is

Next.js 16 app for managing Meta (Facebook) ad campaigns. Connects to Meta Marketing API, Slack, Claude AI, and Redis. Deployed serverless on Vercel.

## Before You Write Code

1. **Run `npm run typecheck` and `npm test`** before and after changes.
2. **Check `CLAUDE.md`** for architecture, security rules, and conventions.
3. **Never use `console.*`** — use `createLogger()` from `@/services/logger`.
4. **Never call `fetch()` in routes** — use the service classes in `src/services/`.
5. **Never use relative imports** — always use `@/` aliases.

## Key Files

| File                          | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `src/types/index.ts`          | All shared domain types — add new types here                  |
| `src/services/meta/`          | MetaService — all Meta Graph API calls                        |
| `src/services/slack/`         | SlackService — all Slack Web API calls                        |
| `src/services/rules-store/`   | RulesStoreService — automation rules (Redis + cookie)         |
| `src/services/anthropic/`     | AnthropicService — Claude API                                 |
| `src/services/logger/`        | createLogger() — structured logger                            |
| `src/lib/automation-utils.ts` | evaluateCondition, getResultCount, getCostPerResult           |
| `src/lib/redis.ts`            | getRedisClient() — null-safe, returns null if REDIS_URL unset |
| `src/lib/session.ts`          | getSession(), setSession()                                    |
| `src/lib/slack-context.ts`    | fetchAdContextData, formatContextForClaude                    |
| `.env.example`                | All environment variables with descriptions                   |

## Service Usage

```ts
// Meta API
const meta = new MetaService(accessToken, adAccountId);
await meta.getCampaigns();
await meta.getFilteredInsights('ad', { datePreset: 'last_7d' });
await meta.updateBudget(objectId, budgetCents);
await meta.executeAction('pause' | 'resume' | 'update_budget', objectId, budgetCents?);

// Meta OAuth (static — no credentials needed)
const token = await MetaService.exchangeCodeForToken(appId, appSecret, code, redirectUri);
const user  = await MetaService.getMe(accessToken);

// Slack
const slack = new SlackService(botToken, signingSecret);
await slack.postMessage(channel, text, blocks?, threadTs?);
await slack.sendAutomationNotification(channel, notification);
await slack.sendBudgetNotification(channel, { entityName, newBudget, previousBudget? });

// Slack OAuth (static)
const data = await SlackService.exchangeCodeForToken(clientId, clientSecret, code, redirectUri);

// Rules store
const redis = await getRedisClient(); // null in dev without REDIS_URL
const store = new RulesStoreService(redis);
await store.getActive();
```

## Security Checklist

- [ ] Every protected route calls `getSession()` and returns 401 if null
- [ ] Slack webhooks call `slack.verifySignature()` before processing
- [ ] No secrets in `NEXT_PUBLIC_` variables or passed to the browser
- [ ] Cron endpoint (`GET /api/automations/evaluate`) checks `CRON_SECRET` bearer token

## Commit Conventions

Enforced by commitlint. Format: `<type>(<scope>): <Subject sentence-case>`

**Types:** `build` `chore` `ci` `docs` `feat` `fix` `perf` `refactor` `revert` `style` `test`

**Subject rules:** first word capitalised, rest lower. Max header 120 chars.

```
feat(ui): Add gallery view to ads page
fix(auth): Redirect to login when session expires
chore(deps): Upgrade tanstack-query to 5.x
```

## Tests

```bash
npm test                 # run all (Vitest)
npm run test:watch       # watch mode
npm run typecheck        # TS only
npm run lint             # ESLint + Prettier check
```

Test files live at `src/**/__tests__/*.test.ts`, colocated with the source they test.
