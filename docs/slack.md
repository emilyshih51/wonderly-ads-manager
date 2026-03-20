# Slack Bot

The bot responds to @mentions in any Slack channel. It fetches live Meta ad data, sends it to Claude for analysis, and posts a response with optional action buttons (pause, resume, adjust budget).

## Setup

### 1. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Scratch
2. Name: "Wonderly Ads Bot" — select your workspace

### 2. Configure permissions

**OAuth & Permissions → Bot Token Scopes:**

- `chat:write`
- `app_mentions:read`
- `channels:history` (for thread memory)

Install to workspace and copy the **Bot User OAuth Token** (`xoxb-...`).

### 3. Configure event subscriptions

**Event Subscriptions → Enable Events → Request URL:**

```
https://wonderly-ads-manager.vercel.app/api/slack/events
```

Subscribe to bot event: `app_mention`

### 4. Configure interactivity

**Interactivity & Shortcuts → Enable → Request URL:**

```
https://wonderly-ads-manager.vercel.app/api/slack/interactions
```

### 5. Set environment variables

In Vercel (Settings → Environment Variables):

```
SLACK_BOT_TOKEN        # xoxb-... from OAuth & Permissions
SLACK_SIGNING_SECRET   # from Basic Information → App Credentials
```

`META_SYSTEM_ACCESS_TOKEN` must also be set — it's what the bot uses to read and write ad data (no user session needed).

## Usage

```
@bot how are my campaigns doing today?
@bot what's the CPA on the Wonderly campaigns?
@bot raise the winners campaign budget by $200
@bot pause the testing ad set
@bot how is Motion doing vs yesterday?
```

The bot supports both Wonderly and Motion accounts — just name the account in your question.

Action buttons (⏸ Pause, ▶ Resume, 💰 Adjust budget) appear when Claude recommends an action. Click once to execute — no undo, so confirm before clicking.

## How it works

```
@mention → /api/slack/events
  → verifySlackSignature() [HMAC-SHA256]
  → return 200 OK immediately (Slack requires < 3s)
  → background: fetch Meta data for all accounts
  → send data + question to Claude
  → parse :::action{...}::: blocks from response
  → post reply with Block Kit buttons

Button click → /api/slack/interactions
  → verifySlackSignature()
  → return 200 OK immediately
  → background: call Meta API (pause / activate / update budget)
  → update Slack message with result
```

## Troubleshooting

| Symptom                   | Check                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Bot doesn't respond       | `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are set; bot is invited to the channel (`/invite @bot`) |
| "Action failed"           | `META_SYSTEM_ACCESS_TOKEN` is valid and has `ads_management` scope                                   |
| URL verification fails    | URL is publicly reachable; no trailing slash                                                         |
| Bot responds with no data | Check Vercel logs — Meta API may be rate-limited or the system token expired                         |

## Security notes

- All inbound Slack requests are verified with HMAC-SHA256 before any processing.
- The timestamp check rejects requests older than 5 minutes (replay protection).
- **No user-level permissions exist** — any workspace member can execute pause/budget actions. This is a known gap tracked in `CLAUDE.md`.
