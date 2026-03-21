import { NextRequest, NextResponse, after } from 'next/server';
import { AnthropicService } from '@/services/anthropic';
import { SlackService, createSlackService } from '@/services/slack';
import { fetchAdContextData, formatContextForClaude } from '@/lib/slack-context';
import { SYSTEM_PROMPT } from '@/app/api/chat/route';
import { createLogger } from '@/services/logger';

// Allow up to 60 seconds for this function (Claude + Meta API calls take time)
export const maxDuration = 60;

const logger = createLogger('Slack:Events');

/**
 * POST /api/slack/events
 *
 * Slack Events API webhook.
 * - Handles URL verification challenge (no signature required)
 * - Handles `app_mention` events when the bot is @mentioned
 * - Deduplicates Slack retries using in-memory event ID tracking
 * - Returns 200 immediately and processes the mention in the background via `after()`
 */

// Simple in-memory deduplication to prevent Slack retries from triggering duplicate processing
const processedEvents = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000; // 60 seconds

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();

  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_WINDOW_MS) processedEvents.delete(id);
  }

  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);

  return false;
}

interface SlackEventBody {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type: string;
    channel: string;
    ts: string;
    thread_ts?: string;
    user?: string;
    text: string;
  };
}

export async function POST(request: NextRequest) {
  const arrayBuffer = await request.arrayBuffer();
  const rawBody = Buffer.from(arrayBuffer).toString('utf-8');
  let body: SlackEventBody;

  try {
    body = JSON.parse(rawBody) as SlackEventBody;
  } catch (e) {
    logger.warn('Invalid event JSON', e);

    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // URL verification must be handled before signature check (Slack sends it unsigned during setup)
  if (body.type === 'url_verification') {
    logger.info('URL verification challenge');

    return NextResponse.json({ challenge: body.challenge });
  }

  const slack = createSlackService();
  const slackSignature = request.headers.get('x-slack-signature') ?? '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') ?? '';

  if (!slack.verifySignature(slackSignature, slackTimestamp, rawBody)) {
    logger.warn('Invalid signature');

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (body.type === 'event_callback' && body.event?.type === 'app_mention') {
    const event = body.event;
    const eventId = body.event_id ?? `${event.channel}_${event.ts}`;

    if (isDuplicateEvent(eventId)) {
      logger.info('Duplicate event, skipping', eventId);

      return NextResponse.json({ ok: true });
    }

    logger.info('Received app_mention', {
      channel: event.channel,
      user: event.user,
      text: event.text,
    });

    // Use after() to process in the background — keeps the serverless function alive
    // while returning 200 to Slack immediately (avoids the 3-second timeout)
    after(async () => {
      try {
        await processAppMention(event);
      } catch (error) {
        logger.error('Background processing error', error);
      }
    });
  }

  return NextResponse.json({ ok: true });
}

interface AppMentionEvent {
  channel: string;
  ts: string;
  thread_ts?: string;
  text: string;
  user?: string;
}

async function processAppMention(event: AppMentionEvent): Promise<void> {
  const channelId = event.channel;
  const threadTs = event.thread_ts ?? event.ts;
  const slack = createSlackService();

  let question = event.text.replace(/<@.+?>/g, '').trim();

  if (!question) question = 'Give me a performance overview';

  try {
    const metaSystemToken = process.env.META_SYSTEM_ACCESS_TOKEN;
    const accountIdsRaw = process.env.META_AD_ACCOUNT_IDS ?? process.env.META_AD_ACCOUNT_ID ?? '';
    const accountIds = accountIdsRaw
      .split(',')
      .map((id) => id.trim().replace(/^act_/, ''))
      .filter(Boolean);

    if (!metaSystemToken || accountIds.length === 0) {
      logger.warn('Missing META_SYSTEM_ACCESS_TOKEN or META_AD_ACCOUNT_ID(S)');
      await slack.postMessage(
        channelId,
        'Sorry, the Slack integration is not fully configured. Please set META_SYSTEM_ACCESS_TOKEN and META_AD_ACCOUNT_ID in your environment.',
        undefined,
        threadTs
      );

      return;
    }

    // Fetch thread history and ad data for all accounts in parallel
    const [threadHistory, ...contextResults] = await Promise.all([
      slack.getThreadMessages(channelId, threadTs),
      ...accountIds.map((id) => fetchAdContextData(id, metaSystemToken)),
    ]);

    // Combine context text from all accounts
    let contextText = '';

    for (let i = 0; i < accountIds.length; i++) {
      const data = contextResults[i];

      if (accountIds.length > 1) {
        const accountName = data.accountName ?? `Account ${accountIds[i]}`;

        contextText += `\n\n===== AD ACCOUNT: ${accountName} (ID: ${accountIds[i]}) =====\n`;
      }

      contextText += formatContextForClaude(data);
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    let analysisText = '';

    if (anthropicKey) {
      try {
        const ai = new AnthropicService(anthropicKey, process.env.ANTHROPIC_MODEL);
        const history = threadHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.text,
        }));

        analysisText = await ai.complete({
          message: question,
          systemPrompt: SYSTEM_PROMPT,
          context: contextText,
          history,
        });
      } catch (claudeError) {
        logger.error('Claude API error', claudeError);
        analysisText = 'I encountered an error analyzing your ad data. Please try again.';
      }
    } else {
      analysisText = 'Claude API not configured.';
    }

    const actions = SlackService.parseActions(analysisText);
    const cleanText = SlackService.stripActions(analysisText);
    const blocks = SlackService.buildBlocks(cleanText, actions, channelId, threadTs);

    await slack.postMessage(channelId, cleanText, blocks, threadTs);
  } catch (error) {
    logger.error('Error processing mention', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    await slack.postMessage(
      channelId,
      `Sorry, I encountered an error: ${errorMsg}`,
      undefined,
      threadTs
    );
  }
}
