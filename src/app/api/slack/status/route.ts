import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/slack/status
 *
 * Returns whether Slack bot is configured
 */
export async function GET(request: NextRequest) {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  return NextResponse.json({
    configured: !!(slackBotToken && slackSigningSecret),
    hasBotToken: !!slackBotToken,
    hasSigningSecret: !!slackSigningSecret,
  });
}
