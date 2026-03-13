# Slack Bot Integration Setup Guide

This guide walks you through setting up the Wonderly Ads Manager Slack bot integration.

## What Does It Do?

The Slack bot allows you to:
- @mention the bot in any Slack channel to ask ad performance questions
- Get AI-powered analysis of your Meta ads performance
- Approve and execute actions directly from Slack (pause campaigns, adjust budgets, etc.)
- Receive detailed insights with actionable recommendations

## Setup Steps

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app "Wonderly Ads Bot" (or similar)
5. Select your workspace
6. Click "Create App"

### 2. Enable Event Subscriptions

1. In your app's sidebar, go to "Event Subscriptions"
2. Toggle "Enable Events" to ON
3. Under "Request URL", paste your Event Request URL:
   ```
   https://your-domain.com/api/slack/events
   ```
   (You can find this URL in your app's Settings > Slack Bot Integration)
4. Slack will verify the URL automatically
5. Under "Subscribe to bot events", click "Add Bot User Event"
6. Search for and select `app_mention`
7. Click "Save Changes"

### 3. Enable Interactivity

1. In your app's sidebar, go to "Interactivity & Shortcuts"
2. Toggle "Interactivity" to ON
3. Paste your Interactivity Request URL:
   ```
   https://your-domain.com/api/slack/interactions
   ```
4. Click "Save Changes"

### 4. Configure OAuth & Permissions

1. In your app's sidebar, go to "OAuth & Permissions"
2. Under "Scopes" > "Bot Token Scopes", add:
   - `chat:write` - to send messages
   - `app_mentions:read` - to receive @mentions
3. Scroll up to "OAuth Tokens for Your Workspace"
4. Click "Install to Workspace"
5. Authorize the app
6. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

### 5. Set Environment Variables

In your `.env.local` file, set:

```env
# Slack Bot Token - from step 4 above
SLACK_BOT_TOKEN=xoxb-your-actual-token-here

# Slack Signing Secret
# Found in your app's Basic Information tab, under "App Credentials"
SLACK_SIGNING_SECRET=your-actual-signing-secret-here

# Meta System Access Token
# This should be a long-lived Meta access token with permissions to read ad insights
META_SYSTEM_ACCESS_TOKEN=your-actual-meta-token-here
```

### 6. Add the Signing Secret

1. In your app's sidebar, go to "Basic Information"
2. Under "App Credentials", find "Signing Secret"
3. Copy this value and add it to `SLACK_SIGNING_SECRET` in `.env.local`

## Testing

Once configured, you can test the bot:

1. Go to any Slack channel in your workspace
2. Type: `@Wonderly Ads Bot how are my campaigns performing?`
3. The bot should respond with an analysis within a few seconds

## Common Commands

- `@bot give me a performance overview`
- `@bot why are my conversions low?`
- `@bot which campaigns should I scale?`
- `@bot what's my spend today?`
- `@bot run a health check`

The bot understands natural language and will analyze your Meta ads data to answer questions and suggest actions.

## Executing Actions from Slack

When the bot recommends actions (pause, resume, adjust budget), you'll see clickable buttons in the Slack message:

1. Click the action button (e.g., "Pause", "Resume", "$50.00")
2. The action will execute immediately
3. The bot will update the message with the result

## Troubleshooting

### Bot doesn't respond to @mentions

- Check that `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are set correctly in `.env.local`
- Verify the Event Request URL is correct and accessible
- Make sure the bot is invited to the channel (or you can invite it with `/invite @Wonderly Ads Bot`)
- Check your app logs for any error messages

### "Action failed" errors

- Ensure `META_SYSTEM_ACCESS_TOKEN` is set and valid
- Verify the token has permissions to manage ads
- Check that the ad IDs in the data are correct

### URL verification fails

- Make sure your Event Request URL is publicly accessible
- Verify that the URL has no trailing slashes
- Check your firewall/security settings

## Advanced Configuration

### Custom System Token

The `META_SYSTEM_ACCESS_TOKEN` should be a Meta app-level token with these permissions:
- `ads_read` - to read ad data
- `ads_management` - to pause/resume ads and adjust budgets (optional)

You can generate this in Meta App Dashboard > Settings > API Security.

### Rate Limiting

The bot uses Slack's standard rate limits. If you hit them, Slack will throttle requests.

## Files Modified/Created

**New Files:**
- `/src/lib/slack.ts` - Slack utility functions
- `/src/app/api/slack/events/route.ts` - Slack events webhook
- `/src/app/api/slack/interactions/route.ts` - Slack button clicks handler
- `/src/app/api/slack/status/route.ts` - Status check endpoint

**Modified Files:**
- `/src/app/api/chat/route.ts` - Exported SYSTEM_PROMPT for Slack bot
- `/src/app/(dashboard)/settings/page.tsx` - Added Slack bot setup UI
- `/.env.local` - Added Slack and Meta system token variables

## Support

For issues with the Slack API, see https://api.slack.com/docs
For issues with Meta API, see https://developers.facebook.com/docs/marketing-api
