import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { createLogger } from '@/services/logger';

const logger = createLogger('Slack:Status');

/**
 * GET /api/slack/status
 *
 * Returns whether Slack bot is configured
 */
export async function GET() {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;

  logger.info('Checking Slack bot configuration');

  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  return NextResponse.json({
    configured: !!(slackBotToken && slackSigningSecret),
    hasBotToken: !!slackBotToken,
    hasSigningSecret: !!slackSigningSecret,
  });
}
