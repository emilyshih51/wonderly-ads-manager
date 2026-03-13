# Slack Bot Integration - Quick Reference

## Quick Setup (5 mins)

### Slack App Setup
1. Create app: https://api.slack.com/apps → Create New App → From Scratch
2. App name: "Wonderly Ads Bot"
3. Enable Event Subscriptions: `app_mention` event → Event URL (see below)
4. Enable Interactivity: (see below)
5. OAuth Scopes: `chat:write`, `app_mentions:read`
6. Install to workspace
7. Copy Bot Token and Signing Secret

### URLs to Configure in Slack

Copy these from Settings > Slack Bot Integration:

**Event Request URL:** `/api/slack/events`
**Interactivity Request URL:** `/api/slack/interactions`

### Environment Variables

In `.env.local`:
```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
META_SYSTEM_ACCESS_TOKEN=...
```

## Using the Bot

### Ask Questions
In Slack: `@Wonderly Ads Bot how are my campaigns?`

### Common Questions
- "Give me a performance overview"
- "Why are my conversions low?"
- "Which campaigns should I scale?"
- "What's my spend today?"
- "Run a health check"

### Execute Actions
Click buttons in bot responses:
- ⏸ Pause - pause campaign/ad set/ad
- ▶ Resume - resume campaign/ad set/ad
- 💰 Set to $X - adjust daily budget

## File Locations

**New Files:**
- `/src/lib/slack.ts` - Slack utilities
- `/src/app/api/slack/events/route.ts` - Webhook for @mentions
- `/src/app/api/slack/interactions/route.ts` - Webhook for button clicks
- `/src/app/api/slack/status/route.ts` - Status endpoint
- `SLACK_BOT_SETUP.md` - Detailed setup guide

**Modified Files:**
- `/src/app/api/chat/route.ts` - Exported SYSTEM_PROMPT
- `/src/app/(dashboard)/settings/page.tsx` - Added setup UI
- `/.env.local` - Added environment variables

## Architecture

```
@mention → /api/slack/events → Claude → /api/slack/interactions
                                    ↓
                            Slack Block Kit message
                            with action buttons
                                    ↓
                         Button click → execute action
                                    ↓
                         Update message with result
```

## Key Implementation Details

### Signature Verification
All Slack requests verified using HMAC-SHA256:
```typescript
verifySlackSignature(request) // checks X-Slack-Signature header
```

### Message Formatting
AI response includes actions in format:
```
:::action{"type":"pause_campaign","id":"123","name":"Campaign"}:::
```
These are parsed and converted to Slack buttons.

### System Access Token
Bot uses `META_SYSTEM_ACCESS_TOKEN` instead of user session:
- No dependency on browser cookies
- Works in background
- Should be long-lived Meta token with `ads_read`, `ads_management` permissions

### Async Processing
Bot responds to Slack immediately (within 3 seconds):
1. Returns `200 OK` acknowledgement
2. Processes analysis in background
3. Posts message asynchronously

## Troubleshooting

### Bot doesn't respond
- [ ] Check SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in .env.local
- [ ] Verify Event Request URL in Slack app settings
- [ ] Bot invited to channel: `/invite @Wonderly Ads Bot`
- [ ] Check app logs for errors

### "Action failed" error
- [ ] META_SYSTEM_ACCESS_TOKEN is valid
- [ ] Token has `ads_management` permission
- [ ] Ad IDs are correct

### URL verification fails
- [ ] URL is publicly accessible (no firewall blocking)
- [ ] No trailing slashes in URL
- [ ] URL matches exactly what's in Slack settings

## API Endpoints

```
POST /api/slack/events       - Slack Events webhook
POST /api/slack/interactions - Slack Interactivity webhook
GET  /api/slack/status       - Check if bot is configured
```

## Response Blocks

The bot sends Slack messages using Block Kit:
- Section blocks - main text content
- Dividers - visual separation
- Actions blocks - interactive buttons
- Context blocks - metadata like timestamps

Example response:
```
[Main analysis text]
────────────────
Recommended Actions:
[Button] Pause    [Button] Resume    [Button] Set to $50
_Click a button to execute_
```

## Security

- HMAC-SHA256 signature verification on all Slack requests
- Timing-safe comparison prevents timing attacks
- No auto-execution - all actions require button click
- System token should be read-only for safety
- All timestamps logged for audit trail

## Monitoring

Check logs for:
- `[Slack Events]` - mention events and analysis
- `[Slack Interactions]` - button clicks and actions
- `[Slack]` - utility functions (postMessage, etc.)

## Limitations

- Max 5 action buttons per row in Slack
- 3-second response requirement to Slack
- Slack API rate limits apply (usually not an issue)
- Actions limited to pause, resume, adjust budget
- Data must fit in Slack message size limits

## Next Steps

1. Complete setup in SLACK_BOT_SETUP.md
2. Test bot with a simple question
3. Configure error notifications (optional)
4. Document custom commands for your team (optional)
5. Monitor logs for issues

## Support Links

- Slack API: https://api.slack.com/docs
- Meta API: https://developers.facebook.com/docs/marketing-api
- Slack Block Kit: https://api.slack.com/block-kit
