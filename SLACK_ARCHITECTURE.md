# Slack Bot Architecture Diagram

## Request Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SLACK USER INTERACTION                       │
│                    "@bot how are my campaigns?"                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Slack sends webhook
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              POST /api/slack/events (Slack webhook)                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ 1. Verify signature (HMAC-SHA256)                             │ │
│  │ 2. Extract @mention event                                     │ │
│  │ 3. Return 200 OK immediately to Slack                         │ │
│  │ 4. Process async in background                                │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Background processing
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Process @mention Event (Async)                         │
│                                                                      │
│  ┌──────────────────────────┐   ┌──────────────────────────┐       │
│  │ Fetch Ad Data            │   │ Send to Claude (Anthropic)│       │
│  ├──────────────────────────┤   ├──────────────────────────┤       │
│  │ • Campaigns (today)      │→→→│ SYSTEM_PROMPT           │       │
│  │ • Ad Sets (today)        │   │ + Full Ad Data Context  │       │
│  │ • Ads (today)            │   │ + User Question         │       │
│  │ • Account (today)        │   │                         │       │
│  │ • Hourly breakdown       │   │ Returns:                │       │
│  │ • Yesterday comparison   │   │ - Analysis text         │       │
│  │ • Historical 30 days     │   │ - Action recommendations│       │
│  │ • Breakdowns             │   │                         │       │
│  │                          │   │ Using Meta API via      │       │
│  │ Using:                   │   │ META_SYSTEM_ACCESS_TOKEN│       │
│  │ META_SYSTEM_ACCESS_TOKEN │   │                         │       │
│  └──────────────────────────┘   └──────────────────────────┘       │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Parse and Format Response                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ 1. Extract action blocks (:::action{...}:::)                 │ │
│  │ 2. Strip action markers from text                            │ │
│  │ 3. Convert markdown to Slack mrkdwn                          │ │
│  │ 4. Build Slack Block Kit:                                   │ │
│  │    - Section blocks (analysis text)                          │ │
│  │    - Divider blocks                                          │ │
│  │    - Action blocks (buttons for each action)                │ │
│  │    - Context blocks (help text)                              │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│      POST Message to Slack (chat.postMessage)                       │
│      ┌──────────────────────────────────────────────────────┐       │
│      │ Full Analysis                          *Bold text*   │       │
│      ├──────────────────────────────────────────────────────┤       │
│      │ Recommended Actions:                                 │       │
│      │ ┌──────────────────────────────────────────────────┐ │       │
│      │ │ [⏸ Pause] [▶ Resume] [💰 Set to $50]           │ │       │
│      │ └──────────────────────────────────────────────────┘ │       │
│      │ _Click a button to execute_                           │       │
│      └──────────────────────────────────────────────────────┘       │
│      Message includes:                                              │
│      • Text analysis                                                │
│      • Slack Block Kit formatted blocks                             │
│      • Interactive action buttons                                   │
│      • Stored message ts for later updates                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ User clicks button in Slack
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│         POST /api/slack/interactions (Interactive component)        │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ 1. Verify signature (HMAC-SHA256)                             │ │
│  │ 2. Parse action payload (button click data)                   │ │
│  │ 3. Return 200 OK immediately to Slack                         │ │
│  │ 4. Execute action async                                       │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ Background processing
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Execute Action (Async)                                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Based on action type:                                         │ │
│  │                                                                │ │
│  │ ┌─────────────────────────────────────────────────────────┐  │ │
│  │ │ PAUSE_CAMPAIGN / PAUSE_AD_SET / PAUSE_AD              │  │ │
│  │ │ → Call: updateStatus(id, token, 'PAUSED')             │  │ │
│  │ └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                │ │
│  │ ┌─────────────────────────────────────────────────────────┐  │ │
│  │ │ RESUME_CAMPAIGN / RESUME_AD_SET / RESUME_AD            │  │ │
│  │ │ → Call: updateStatus(id, token, 'ACTIVE')              │  │ │
│  │ └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                │ │
│  │ ┌─────────────────────────────────────────────────────────┐  │ │
│  │ │ ADJUST_BUDGET                                           │  │ │
│  │ │ → Call: metaApi(id, token, { daily_budget: cents })   │  │ │
│  │ └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                │ │
│  │ Using:                                                         │ │
│  │ META_SYSTEM_ACCESS_TOKEN                                      │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│      Update Slack Message (chat.update)                             │
│      ┌──────────────────────────────────────────────────────┐       │
│      │ ✅ Paused "Campaign Name"                           │       │
│      │ _Executed at 2:45 PM_                                │       │
│      └──────────────────────────────────────────────────────┘       │
│      Updates original message with:                                 │
│      • Success/failure status                                       │
│      • Timestamp of execution                                       │
│      • Error message if failed                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SLACK BOT INTEGRATION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐      ┌──────────────────┐                │
│  │   slack.ts       │      │  Settings Page   │                │
│  ├──────────────────┤      ├──────────────────┤                │
│  │ • Verification   │      │ • Config status  │                │
│  │ • Messages       │      │ • Setup guide    │                │
│  │ • Block Kit      │      │ • Copy URLs      │                │
│  │ • Formatting     │      │ • Instructions   │                │
│  └────────┬─────────┘      └────────┬─────────┘                │
│           │                         │                           │
│  ┌────────▼──────────┐    ┌────────▼──────────┐               │
│  │  Slack Events     │    │  Slack Status     │               │
│  │  /slack/events    │    │  /slack/status    │               │
│  │                   │    │                   │               │
│  │ • Verify sig      │    │ • Check tokens    │               │
│  │ • Parse @mention  │    │ • Return status   │               │
│  │ • Fetch data      │    │                   │               │
│  │ • Call Claude     │    └───────────────────┘               │
│  │ • Build blocks    │                                         │
│  │ • Post message    │                                         │
│  └────────┬─────────┘                                         │
│           │                                                    │
│  ┌────────▼──────────────────┐                               │
│  │ Slack Interactions        │                               │
│  │ /slack/interactions       │                               │
│  │                           │                               │
│  │ • Verify sig              │                               │
│  │ • Parse button click      │                               │
│  │ • Execute action          │                               │
│  │ • Update message          │                               │
│  └──────────┬────────────────┘                               │
│             │                                                │
│  ┌──────────▼────────────────────┐                          │
│  │ External Dependencies         │                          │
│  ├───────────────────────────────┤                          │
│  │ • Slack API (webhooks)        │                          │
│  │ • Claude API (Anthropic)      │                          │
│  │ • Meta API (ads management)   │                          │
│  └───────────────────────────────┘                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

```
User Message (Slack)
    ↓
Event Verification
    ↓
Extract Question + Context
    ↓
Fetch Meta Ad Data
    ├─ Today's metrics
    ├─ Yesterday's metrics
    ├─ Historical trends
    ├─ Hourly breakdowns
    └─ Demographic breakdowns
    ↓
Send to Claude with SYSTEM_PROMPT
    ├─ Analysis instructions
    ├─ Data context
    └─ User question
    ↓
Claude Response
    ├─ Analysis text
    └─ Action blocks (:::action{...}:::)
    ↓
Parse & Format
    ├─ Extract actions
    ├─ Convert to markdown
    └─ Build Block Kit
    ↓
Post to Slack
    ├─ Text analysis
    └─ Interactive buttons
    ↓
User Clicks Button
    ↓
Verify Request
    ↓
Execute Action
    ├─ Call Meta API
    └─ Update Slack message
```

## Security Model

```
Request Verification
│
├─ Slack Signature Check
│  ├─ X-Slack-Signature header
│  ├─ HMAC-SHA256(key=SLACK_SIGNING_SECRET)
│  ├─ Timing-safe comparison
│  └─ Timestamp validation (5 min max age)
│
├─ Request Throttling
│  ├─ Slack's built-in rate limits
│  └─ Immediate 200 OK response
│
├─ Token Management
│  ├─ SLACK_BOT_TOKEN - never exposed to client
│  ├─ META_SYSTEM_ACCESS_TOKEN - never exposed to client
│  └─ SLACK_SIGNING_SECRET - never exposed to client
│
└─ Action Safety
   ├─ No auto-execution (button click required)
   ├─ Explicit action parsing
   └─ Result feedback to user
```

## File Organization

```
wonderly-ads-manager/
├── src/
│   ├── lib/
│   │   └── slack.ts ........................ Slack utilities
│   └── app/api/
│       ├── chat/
│       │   └── route.ts ................... (modified - export SYSTEM_PROMPT)
│       └── slack/
│           ├── events/
│           │   └── route.ts .............. Events webhook
│           ├── interactions/
│           │   └── route.ts .............. Interactions webhook
│           └── status/
│               └── route.ts .............. Status check
├── .env.local ............................. (modified - added Slack vars)
├── src/app/(dashboard)/
│   └── settings/page.tsx .................. (modified - added setup UI)
├── SLACK_BOT_SETUP.md ..................... Setup guide
├── SLACK_INTEGRATION_QUICK_REFERENCE.md .. Quick reference
└── SLACK_ARCHITECTURE.md ................. This file
```

## Timing

```
Event Received
    │
    ├─ Parse & Verify: <100ms
    │
    ├─ Return 200 OK to Slack: <500ms (Slack requirement: <3s)
    │
    └─ Background Processing:
       ├─ Fetch Meta data: 1-3s
       ├─ Call Claude API: 2-5s
       ├─ Format response: <100ms
       └─ Post to Slack: <1s

    Total: 3-9 seconds (all async, user gets response in Slack)
```
