import { NextRequest, NextResponse, after } from 'next/server';
import { AnthropicService } from '@/services/anthropic';
import { OpenAIService, OpenAIApiError } from '@/services/openai';
import { SlackService, createSlackService } from '@/services/slack';
import { fetchAdContextData, formatContextForClaude } from '@/lib/slack-context';
import { getRedisClient } from '@/lib/redis';
import { ChatMemoryService } from '@/services/chat-memory';
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

    // Channel allowlist — only respond in permitted channels
    const allowedChannels = (process.env.ALLOWED_SLACK_CHANNEL_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedChannels.length > 0 && !allowedChannels.includes(event.channel)) {
      logger.warn('app_mention from disallowed channel, ignoring', { channel: event.channel });

      return NextResponse.json({ ok: true });
    }

    // User allowlist — only respond to permitted users
    const allowedUsers = (process.env.ALLOWED_SLACK_USER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedUsers.length > 0 && event.user && !allowedUsers.includes(event.user)) {
      logger.warn('app_mention from disallowed user, ignoring', { user: event.user });

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

    // Fetch thread history, cross-thread memory, and ad data in parallel
    const redis = await getRedisClient();
    const memory = new ChatMemoryService(redis);
    const memoryKey = `slack:${channelId}`;

    const [threadHistory, crossThreadMemory, ...contextResults] = await Promise.all([
      slack.getThreadMessages(channelId, threadTs),
      memory.getHistory(memoryKey),
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

    const provider = slackBotProvider();
    let analysisText = '';

    // Persist user question to cross-thread memory
    await memory.appendMessage(memoryKey, {
      role: 'user',
      content: question,
      timestamp: Date.now(),
    });

    if (provider) {
      try {
        // Combine cross-thread memory (older) with current thread history (newer)
        const pastMemory = crossThreadMemory.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const threadMessages = threadHistory.map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.text,
        }));

        // Past memory first, then current thread — thread takes priority for recency
        const history = [...pastMemory, ...threadMessages];
        const ai =
          provider === 'openai'
            ? new OpenAIService(process.env.OPENAI_API_KEY ?? '', process.env.OPENAI_MODEL)
            : new AnthropicService(
                process.env.ANTHROPIC_API_KEY ?? '',
                process.env.ANTHROPIC_MODEL
              );

        analysisText = await ai.complete({
          message: question,
          systemPrompt: SYSTEM_PROMPT,
          context: contextText,
          history,
        });
      } catch (aiError) {
        logger.error(`Slack bot AI error (${provider})`, aiError);
        analysisText = friendlyAiError(provider, aiError);
      }
    } else {
      analysisText =
        'The AI for this bot isn’t set up. Add OPENAI_API_KEY (or ANTHROPIC_API_KEY) in Vercel.';
    }

    const actions = SlackService.parseActions(analysisText);
    const cleanText = SlackService.stripActions(analysisText);
    const blocks = SlackService.buildBlocks(cleanText, actions, channelId, threadTs);

    await slack.postMessage(channelId, cleanText, blocks, threadTs);

    // Persist bot response to cross-thread memory
    await memory.appendMessage(memoryKey, {
      role: 'assistant',
      content: cleanText,
      timestamp: Date.now(),
    });
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

/**
 * Which AI the Slack bot uses. `SLACK_BOT_AI_PROVIDER` (`openai` | `anthropic`) wins;
 * otherwise OpenAI when `OPENAI_API_KEY` is set, else Anthropic. Only the Slack bot reads
 * this — the web AI Chat page always uses Anthropic.
 */
function slackBotProvider(): 'openai' | 'anthropic' | null {
  const chosen = (process.env.SLACK_BOT_AI_PROVIDER ?? '').trim().toLowerCase();

  if (chosen === 'openai') return process.env.OPENAI_API_KEY ? 'openai' : null;
  if (chosen === 'anthropic') return process.env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';

  return null;
}

/** Plain-English message for the thread instead of a raw API error dump. */
function friendlyAiError(provider: 'openai' | 'anthropic', error: unknown): string {
  const name = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    (error instanceof OpenAIApiError && error.code === 'insufficient_quota') ||
    lower.includes('credit balance') ||
    lower.includes('quota')
  ) {
    return `I can't answer right now: the ${name} API account is out of credits. Add credits in the ${name} billing page and try again.`;
  }

  if (
    (error instanceof OpenAIApiError && error.status === 401) ||
    lower.includes('invalid x-api-key') ||
    lower.includes('incorrect api key')
  ) {
    return `I can't answer right now: the ${name} API key is invalid. Check it in Vercel.`;
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('does not exist'))
  ) {
    return `I can't answer right now: the ${name} model isn't available. Set ${provider === 'openai' ? 'OPENAI_MODEL' : 'ANTHROPIC_MODEL'} in Vercel to a current model.`;
  }

  return `I couldn't get an answer from ${name} just now. Try again in a minute.`;
}
