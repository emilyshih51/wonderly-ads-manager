# Execute Issues Plan

## Objective

Implement all 11 issues from `docs/issues-plan.md`: 3 critical security fixes, 4 high-priority cleanup items, and 4 medium quality improvements.

## Research Findings

- **Issue #8 (history UI)**: Already implemented. `automations/page.tsx` has `fetchHistory`, `setActivityLog`, and renders the Activity Log section. No work needed.
- **Issue #9 (Hook-in-callback)**: `useTemplate` is a plain callback function (line 962), not a React hook. The fix is renaming it to `applyTemplate` — ESLint treats any function named `use*` as a hook.
- **Issue #10 (img → Image)**: The `adsets/page.tsx:1064` `<img>` renders a local `blob:` URL from file upload — `next/image` cannot handle these. Only `ads/page.tsx:255` (remote Meta CDN URL) needs the fix.
- **Supabase**: Zero imports outside the lib files themselves. Safe to delete both files and both packages.
- **@vercel/kv**: Zero imports anywhere. Safe to remove.

## Validation Methodology

**Primary validation:** TypeScript compile + ESLint clean pass

**Validation command:**

```bash
npm run validate
```

**Expected result:** Zero errors from `tsc --noEmit`, zero ESLint errors (warnings for `any` types are acceptable).

**Why this level:** No tests exist. TypeScript + lint gives the highest automated coverage available and catches the classes of issues we're fixing (unused vars, type errors, hook violations).

## PR Stack

| PR  | Branch                      | Steps | Description                                        |
| --- | --------------------------- | ----- | -------------------------------------------------- |
| 1   | fix/login-restriction       | 1     | Critical: email allowlist on OAuth callback        |
| 2   | fix/cron-auth               | 2     | Critical: protect cron endpoint                    |
| 3   | fix/slack-user-permissions  | 3     | Critical: Slack action allowlist                   |
| 4   | fix/cleanup-deps-and-safety | 4–7   | High: remove dead deps, action cap, data freshness |
| 5   | fix/code-quality            | 8–10  | Medium: rename hook fn, Image, clean unused vars   |

---

## Implementation Steps

### Step 1 — Login allowlist

**Files:**

- `src/app/api/auth/facebook/callback/route.ts`

**Changes:**
After `const userData = await userResponse.json();` (line 35), add the allowlist check before the session is created:

```ts
const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (allowedEmails.length > 0 && !allowedEmails.includes(userData.email)) {
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login?error=unauthorized`);
}
```

**Verification:**

- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no new errors

---

### Step 2 — Protect the cron endpoint

**Files:**

- `src/app/api/automations/evaluate/route.ts`

**Changes:**
The `GET` handler currently has no auth at all. Add the Vercel cron secret check at the very top — before `getSession()` is called. The guard must only fire when `CRON_SECRET` is set (so local dev without the var still works):

```ts
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  // ... rest of handler
```

Note: The function signature currently uses `GET()` with no argument. Change to `GET(request: NextRequest)` — the import is already at the top.

**Verification:**

- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no new errors

---

### Step 3 — Slack user permission check

**Files:**

- `src/app/api/slack/interactions/route.ts`

**Changes:**
In `processInteraction`, after extracting `actionValue` (line ~69), add the allowlist check before the `switch` statement. The user ID is on `payload.user.id`:

```ts
const allowedSlackUsers = (process.env.ALLOWED_SLACK_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const requestingUserId = payload.user?.id;
if (allowedSlackUsers.length > 0 && !allowedSlackUsers.includes(requestingUserId)) {
  const channelId = actionValue.channel_id || channel?.id;
  const threadTs = actionValue.thread_ts;
  if (channelId) {
    await postSlackMessage(
      channelId,
      "You don't have permission to execute actions.",
      undefined,
      threadTs
    );
  }
  return;
}
```

`postSlackMessage` is already imported in this file.

**Verification:**

- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no new errors

---

### Step 4 — Remove dead Supabase dependency

**Files:**

- `src/lib/supabase-browser.ts` — delete
- `src/lib/supabase-server.ts` — delete
- `package.json` — remove `@supabase/ssr` and `@supabase/supabase-js`

**Changes:**

1. Delete both files.
2. In `package.json` dependencies, remove the two `@supabase/*` lines.
3. Run `npm install` to update lock file.

**Verification:**

- [ ] `npm run typecheck` — no errors (no remaining imports)
- [ ] `npm run lint` — no new errors

---

### Step 5 — Remove deprecated @vercel/kv

**Files:**

- `package.json`

**Changes:**
Remove `"@vercel/kv": "^3.0.0"` from dependencies. Run `npm install`.

**Verification:**

- [ ] `npm install` — completes without error
- [ ] `npm run typecheck` — no errors

---

### Step 6 — Daily action cap on automation engine

**Files:**

- `src/app/api/automations/evaluate/route.ts`

**Changes:**
In the `evaluateRule` function, add a counter parameter and check. The cap needs to be tracked across the _entire_ cron run, not per rule — so it should be tracked in the `GET` handler and passed into `evaluateRule`.

In `GET` handler, before the rule loop:

```ts
const maxActionsPerRun = parseInt(process.env.AUTOMATION_MAX_ACTIONS_PER_RUN || '20');
let totalActionsExecuted = 0;
```

Pass `totalActionsExecuted` and `maxActionsPerRun` into `evaluateRule`, returning the updated count.

Simpler approach (avoids refactoring the function signature): track within `evaluateRule` via a shared object:

```ts
const actionCap = {
  executed: 0,
  max: parseInt(process.env.AUTOMATION_MAX_ACTIONS_PER_RUN || '20'),
};
// pass actionCap to evaluateRule, mutate cap.executed inside
```

In `evaluateRule`, before the `if (dryRun)` block:

```ts
if (!dryRun) {
  if (actionCap.executed >= actionCap.max) {
    actionResult.skipped = 'action_cap_reached';
    results.push(actionResult);
    continue;
  }
  actionCap.executed++;
}
```

**Verification:**

- [ ] `npm run typecheck` — no errors

---

### Step 7 — Skip automation on empty Meta response

**Files:**

- `src/app/api/automations/evaluate/route.ts`

**Changes:**
In `evaluateRule`, after `insightsData` is populated (all three branches of the `if/else if`), add before the `for` loop:

```ts
if (insightsData.length === 0 && !dryRun) {
  console.warn(
    `[Evaluate] No data returned for account ${adAccountId} (rule: "${rule.name}") — skipping to avoid false pauses`
  );
  return [{ rule: rule.name, skipped: 'no_data_returned', account: adAccountId }];
}
```

**Verification:**

- [ ] `npm run typecheck` — no errors

---

### Step 8 — Rename useTemplate → applyTemplate

**Files:**

- `src/app/(dashboard)/automations/page.tsx`

**Changes:**
Rename `useTemplate` to `applyTemplate` in both places (line 962 definition, line 1224 usage in onClick). This eliminates the `react-hooks/rules-of-hooks` ESLint error since ESLint only enforces hook rules on functions named `use*`.

**Verification:**

- [ ] `npm run lint` — `react-hooks/rules-of-hooks` error gone from this file

---

### Step 9 — Replace `<img>` with `<Image />` in ads/page.tsx

**Files:**

- `src/app/(dashboard)/ads/page.tsx`
- `next.config.ts`

**Changes:**

In `next.config.ts`, add remote image pattern for Meta CDN:

```ts
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**.fbcdn.net' },
    { protocol: 'https', hostname: '**.facebook.com' },
  ],
},
```

(Use `remotePatterns` not the deprecated `domains`.)

In `ads/page.tsx`, add `import Image from 'next/image'` (the component already imports `Image` from lucide-react under a different alias — use `NextImage` alias):

```ts
import NextImage from 'next/image';
```

Replace the `<img>` tag:

```tsx
<NextImage
  src={ad.creative.thumbnail_url || ad.creative.image_url || ''}
  alt={ad.name}
  width={40}
  height={40}
  className="rounded object-cover"
/>
```

Note: `adsets/page.tsx:1064` renders a local `blob:` URL from a file upload — `next/image` cannot handle blob URLs. Leave that one as `<img>`.

**Verification:**

- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — `@next/next/no-img-element` warning gone from `ads/page.tsx`

---

### Step 10 — Clean up unused imports and variables

**Files:**

- `src/app/(dashboard)/automations/page.tsx` — `AlertCircle`, `Target`, `Filter` imports; `operatorPatterns` variable
- `src/app/(dashboard)/adsets/page.tsx` — `formatCurrency` import, `loading` variable
- `src/app/(dashboard)/ads/page.tsx` — `storeDatePreset`

**Changes:**
Run `npm run lint:fix` to auto-remove what ESLint can fix. Then manually remove anything that wasn't auto-fixed. Specifically:

- Remove `AlertCircle`, `Target`, `Filter` from the lucide-react import block in automations page
- Remove the `operatorPatterns` variable definition
- Remove unused `formatCurrency` import in adsets
- Remove unused `loading` variable in adsets
- Remove unused `storeDatePreset` in ads

**Verification:**

- [ ] `npm run validate` — zero errors

---

## Key Decisions

- **Issue #8 (history UI)**: Already done — activity log is rendered and fetched. No work needed.
- **Issue #10 (adsets img)**: Blob URLs from file uploads cannot use `next/image`. Only the ads page (remote Meta CDN URLs) gets the `<Image />` treatment.
- **Issue #9 (hook false positive)**: Rename only — no structural change to the component.
- **Action cap (issue #6)**: Tracked via a shared mutable object passed to `evaluateRule` rather than refactoring the full function signature (simpler, same result).
- **Cron auth (issue #2)**: Guard is opt-in — only enforced when `CRON_SECRET` env var is set. Doesn't break local dev.

## Remaining Unknowns

- Meta CDN hostname patterns: `**.fbcdn.net` and `**.facebook.com` should cover standard creative thumbnails. If new CDN hostnames appear, add them to `remotePatterns`.
- `ALLOWED_EMAILS`/`ALLOWED_SLACK_USER_IDS` env vars must be added to Vercel after deploying — the code is safe to deploy without them (empty = allow all, maintaining current behavior until configured).
