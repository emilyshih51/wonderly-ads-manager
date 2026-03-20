# Issues Plan

Prioritized fixes for the known gaps documented in `CLAUDE.md`. Work these in order — critical items block production safety, high items are operational risks, medium items are quality-of-life.

---

## Critical

### 1. Restrict login to authorized users

**File:** `src/app/api/auth/facebook/callback/route.ts`

After fetching `userData` (line ~33), add an allowlist check before setting the session cookie. Simplest approach is an env var:

```ts
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim());
if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(userData.email)) {
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=unauthorized`);
}
```

Add `ALLOWED_EMAILS` to Vercel env vars (comma-separated list of authorized email addresses).

---

### 2. Protect the cron endpoint

**File:** `src/app/api/automations/evaluate/route.ts`

The `GET` handler has no auth. Vercel cron sends a secret header automatically when `CRON_SECRET` is set in env vars.

Add at the top of the `GET` handler:

```ts
const cronSecret = request.headers.get('authorization');
if (process.env.CRON_SECRET && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Set `CRON_SECRET` in Vercel env vars (any random secret string). Vercel injects `Authorization: Bearer <CRON_SECRET>` automatically on cron requests.

---

### 3. Add Slack user permissions for destructive actions

**File:** `src/app/api/slack/interactions/route.ts`

The interaction handler executes pause/budget changes for any workspace user. Add an allowlist:

```ts
const ALLOWED_SLACK_USERS = (process.env.ALLOWED_SLACK_USER_IDS || '')
  .split(',')
  .map((s) => s.trim());
const userId = payload.user?.id;
if (ALLOWED_SLACK_USERS.length > 0 && !ALLOWED_SLACK_USERS.includes(userId)) {
  await postSlackMessage(
    channelId,
    "Sorry, you don't have permission to execute actions.",
    undefined,
    threadTs
  );
  return NextResponse.json({ ok: true });
}
```

Add `ALLOWED_SLACK_USER_IDS` to Vercel env vars (comma-separated Slack user IDs — find yours at `https://api.slack.com/methods/auth.test`).

---

## High

### 4. Remove dead Supabase dependency

**Files to delete:** `src/lib/supabase-browser.ts`, `src/lib/supabase-server.ts`

**package.json** — remove:

```json
"@supabase/ssr": "^0.9.0",
"@supabase/supabase-js": "^2.99.0",
```

**package.json** — remove from devDependencies if present, then run `npm install`.

Also remove `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Vercel env vars after confirming nothing imports these files.

Run `grep -r "supabase" src/` first to confirm no live usage before deleting.

---

### 5. Remove deprecated @vercel/kv dependency

**package.json** — remove:

```json
"@vercel/kv": "^3.0.0",
```

The codebase uses the `redis` package directly in `src/lib/rules-store.ts`. `@vercel/kv` is not imported anywhere — it's a leftover.

---

### 6. Add a daily action cap to the automation engine

**File:** `src/app/api/automations/evaluate/route.ts`

Before executing actions, add a guard that stops after N total actions per cron run:

```ts
const MAX_ACTIONS_PER_RUN = parseInt(process.env.AUTOMATION_MAX_ACTIONS_PER_RUN || '20');
let actionsExecuted = 0;

// Inside the loop, before executing:
if (actionsExecuted >= MAX_ACTIONS_PER_RUN) {
  actionResult.skipped = 'max_actions_reached';
  results.push(actionResult);
  continue;
}
actionsExecuted++;
```

Default to 20. Add `AUTOMATION_MAX_ACTIONS_PER_RUN` as an optional env var to tune it.

---

### 7. Validate Meta data freshness before automation runs

**File:** `src/app/api/automations/evaluate/route.ts`

After fetching `insightsData`, skip evaluation if Meta returns zero rows unexpectedly for an active account (likely a reporting outage):

```ts
if (insightsData.length === 0 && entityType === 'ad') {
  console.warn(
    `[Evaluate] No ad data returned for account ${adAccountId} — skipping rule "${rule.name}" to avoid false pauses`
  );
  results.push({ rule: rule.name, skipped: 'no_data_returned' });
  continue;
}
```

This won't catch partial-delay scenarios, but prevents the worst case (pausing everything when Meta returns empty).

---

## Medium

### 8. Expose automation history in the UI

**Files:** `src/app/(dashboard)/automations/page.tsx`, `src/app/api/automations/history/route.ts`

The history route already exists. Wire it up to a simple table in the automations page — show rule name, timestamp, entity affected, action taken, and result. Fetch on page load with a `useEffect`.

---

### 9. Fix the Hook-in-callback violation

**File:** `src/app/(dashboard)/automations/page.tsx`, line 1224

`useTemplate` is called inside a callback — this violates the Rules of Hooks and is a runtime bug waiting to happen. Move the hook call to the component body and pass the result down into the callback.

---

### 10. Replace `<img>` with Next.js `<Image />`

**Files:** `src/app/(dashboard)/ads/page.tsx:255`, `src/app/(dashboard)/adsets/page.tsx:1064`

Swap `<img src={...}>` for `next/image` `<Image>` to get automatic optimization, lazy loading, and avoid the `@next/next/no-img-element` lint warning.

Add the Meta CDN domain to `next.config.ts`:

```ts
images: {
  domains: ['scontent.xx.fbcdn.net'],
}
```

---

### 11. Clean up unused imports and variables

Run `npm run lint:fix` — this will auto-fix the unused variables flagged by `@typescript-eslint/no-unused-vars`. Review the diff before committing. Key ones:

- `src/app/(dashboard)/automations/page.tsx` — `AlertCircle`, `Target`, `Filter`, `operatorPatterns`
- `src/app/(dashboard)/adsets/page.tsx` — `formatCurrency`, `loading`
- `src/app/(dashboard)/ads/page.tsx` — `storeDatePreset`

---

## Order of operations

```
Week 1 (security):  Issues 1 → 2 → 3
Week 2 (cleanup):   Issues 4 → 5 → 6 → 7
Week 3 (quality):   Issues 8 → 9 → 10 → 11
```

Do not batch Week 1 items into a single PR — each is an independent security fix and easier to review and revert individually.
