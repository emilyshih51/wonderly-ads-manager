import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifySlackSignature, postSlackMessage, buildSlackBlocks, parseActions, stripActions } from '@/lib/slack';
import { SYSTEM_PROMPT } from '../../chat/route';
import {
  getCampaignLevelInsights,
  getAdSetLevelInsights,
  getAdLevelInsights,
  getInsightsForDateRange,
  getHourlyInsights,
  getHourlyInsightsForDate,
  getInsightsWithBreakdowns,
  getAccountInsights,
  getCampaignOptimizationMap,
  getDailyInsights,
} from '@/lib/meta-api';
import { generateMockChatData } from '../../chat/data/mock';

/**
 * POST /api/slack/events
 *
 * Slack Events API webhook
 * - Handles URL verification
 * - Handles app_mention events (when bot is @mentioned)
 * - Responds within 3 seconds
 */

// Helper to get raw request body for signature verification
async function getRawBody(request: NextRequest): Promise<string> {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('utf-8');
}

export async function POST(request: NextRequest) {
  const rawBody = await getRawBody(request);
  let body: any;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Verify Slack signature
  const slackSignature = request.headers.get('x-slack-signature') || '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') || '';
  const isValid = verifySlackSignature(slackSignature, slackTimestamp, rawBody);

  if (!isValid) {
    console.warn('[Slack Events] Invalid signature');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Handle URL verification challenge
  if (body.type === 'url_verification') {
    console.log('[Slack Events] URL verification challenge');
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle app_mention event
  if (body.type === 'event_callback' && body.event?.type === 'app_mention') {
    const event = body.event;
    console.log('[Slack Events] Received app_mention:', { channel: event.channel, user: event.user, text: event.text });

    // Respond immediately to avoid timeout
    const ack = NextResponse.json({ ok: true });

    // Process async in the background
    processAppMention(event).catch((error) => {
      console.error('[Slack Events] Background processing error:', error);
    });

    return ack;
  }

  // Ignore other event types
  return NextResponse.json({ ok: true });
}

async function processAppMention(event: any) {
  const channelId = event.channel;
  const threadTs = event.thread_ts || event.ts;
  const userId = event.user;

  // Extract the actual question (remove @bot mention)
  let question = event.text.replace(/<@.+?>/g, '').trim();

  if (!question) {
    question = 'Give me a performance overview';
  }

  try {
    // Fetch ad data using system access token (no session needed)
    const metaSystemToken = process.env.META_SYSTEM_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;

    if (!metaSystemToken || !adAccountId) {
      console.warn('[Slack Events] Missing META_SYSTEM_ACCESS_TOKEN or META_AD_ACCOUNT_ID');
      await postSlackMessage(
        channelId,
        'Sorry, the Slack integration is not fully configured. Please set META_SYSTEM_ACCESS_TOKEN and META_AD_ACCOUNT_ID in your environment.'
      );
      return;
    }

    // Fetch comprehensive ad data
    const contextData = await fetchAdContextData(adAccountId, metaSystemToken);
    const contextText = formatContextForClaude(contextData);

    // Send to Claude
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let analysisText = '';

    if (anthropicKey) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey });

        const message = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SYSTEM_PROMPT + contextText,
          messages: [{ role: 'user', content: question }],
        });

        // Extract text from response
        for (const block of message.content) {
          if (block.type === 'text') {
            analysisText = block.text;
            break;
          }
        }
      } catch (claudeError) {
        console.error('[Slack Events] Claude API error:', claudeError);
        analysisText = 'I encountered an error analyzing your ad data. Please try again.';
      }
    } else {
      // Fallback if no Claude API key
      analysisText = 'Claude API not configured. Using mock analysis would go here.';
    }

    // Parse actions from response
    const actions = parseActions(analysisText);
    const cleanText = stripActions(analysisText);

    // Build Slack blocks
    const blocks = buildSlackBlocks(cleanText, actions, channelId, threadTs);

    // Post message (threaded if replying to a message)
    await postSlackMessage(channelId, cleanText, blocks);

  } catch (error) {
    console.error('[Slack Events] Error processing mention:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await postSlackMessage(channelId, `Sorry, I encountered an error: ${errorMsg}`);
  }
}

/**
 * Fetch comprehensive ad data using system access token
 */
async function fetchAdContextData(adAccountId: string, accessToken: string) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  try {
    // Fetch all data in parallel
    const results = await Promise.allSettled([
      getCampaignLevelInsights(adAccountId, accessToken, 'today'),
      getInsightsForDateRange(adAccountId, accessToken, yesterdayStr, yesterdayStr, 'campaign'),
      getAdSetLevelInsights(adAccountId, accessToken, 'today'),
      getInsightsForDateRange(adAccountId, accessToken, yesterdayStr, yesterdayStr, 'adset'),
      getAdLevelInsights(adAccountId, accessToken, 'today'),
      getInsightsForDateRange(adAccountId, accessToken, yesterdayStr, yesterdayStr, 'ad'),
      getHourlyInsights(adAccountId, accessToken, 'today', 'campaign'),
      getHourlyInsightsForDate(adAccountId, accessToken, yesterdayStr, yesterdayStr, 'campaign'),
      getAccountInsights(adAccountId, accessToken, 'today'),
      getInsightsForDateRange(adAccountId, accessToken, yesterdayStr, yesterdayStr, 'account'),
      getInsightsWithBreakdowns(adAccountId, accessToken, 'today', 'age,gender'),
      getInsightsWithBreakdowns(adAccountId, accessToken, 'today', 'device_platform'),
      getInsightsWithBreakdowns(adAccountId, accessToken, 'today', 'publisher_platform'),
      getCampaignOptimizationMap(adAccountId, accessToken),
      getDailyInsights(adAccountId, accessToken, 'last_30d', 'account'),
      getDailyInsights(adAccountId, accessToken, 'last_30d', 'campaign'),
      getDailyInsights(adAccountId, accessToken, 'last_7d', 'adset'),
    ]);

    const extract = (index: number) => {
      const r = results[index];
      if (r.status === 'fulfilled') return r.value?.data || [];
      return [];
    };

    const optimizationMap = results[13].status === 'fulfilled'
      ? results[13].value as Record<string, string>
      : {};

    return {
      date: { today: todayStr, yesterday: yesterdayStr, thirtyDaysAgo: thirtyDaysAgoStr },
      optimizationMap,
      today: {
        campaigns: extract(0),
        adSets: extract(2),
        ads: extract(4),
        account: extract(8),
        hourly: extract(6),
      },
      yesterday: {
        campaigns: extract(1),
        adSets: extract(3),
        ads: extract(5),
        account: extract(9),
        hourly: extract(7),
      },
      history: {
        accountDaily: extract(14),
        campaignDaily: extract(15),
        adsetDaily: extract(16),
      },
      breakdowns: {
        ageGender: extract(10),
        device: extract(11),
        publisher: extract(12),
      },
    };
  } catch (error) {
    console.error('[Slack Events] Error fetching ad data:', error);
    // Return empty structure, will fall back to mock
    return generateMockChatData();
  }
}

/**
 * Format ad data for Claude context (same as web chat)
 */
function formatContextForClaude(data: any): string {
  let context = '';

  // Account totals
  const todayAccount = data.today.account?.[0];
  const yesterdayAccount = data.yesterday.account?.[0];

  if (todayAccount) {
    context += `Today: Spend $${(parseInt(todayAccount.spend) / 100).toFixed(2)}, Impressions ${todayAccount.impressions || 0}, Clicks ${todayAccount.clicks || 0}, CTR ${(parseFloat(todayAccount.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(todayAccount.cpc) || 0).toFixed(2)}\n`;
  }

  if (yesterdayAccount) {
    context += `Yesterday: Spend $${(parseInt(yesterdayAccount.spend) / 100).toFixed(2)}, Impressions ${yesterdayAccount.impressions || 0}, Clicks ${yesterdayAccount.clicks || 0}, CTR ${(parseFloat(yesterdayAccount.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(yesterdayAccount.cpc) || 0).toFixed(2)}\n`;
  }

  context += '\n';

  // Campaign breakdown
  for (const campaign of data.today.campaigns || []) {
    context += `Campaign "${campaign.campaign_name}": TODAY Spend $${(parseInt(campaign.spend) / 100).toFixed(2)}, Impressions ${campaign.impressions}, Clicks ${campaign.clicks}, CTR ${(parseFloat(campaign.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(campaign.cpc) || 0).toFixed(2)}, Results ${campaign.actions || 0}. `;

    const yesterdayCampaign = data.yesterday.campaigns?.find((c: any) => c.campaign_id === campaign.campaign_id);
    if (yesterdayCampaign) {
      const spendChange = ((parseInt(campaign.spend) - parseInt(yesterdayCampaign.spend)) / parseInt(yesterdayCampaign.spend) * 100).toFixed(1);
      const resultsChange = ((parseInt(campaign.actions || 0) - parseInt(yesterdayCampaign.actions || 0)) / Math.max(1, parseInt(yesterdayCampaign.actions || 0)) * 100).toFixed(1);
      context += `YESTERDAY Spend $${(parseInt(yesterdayCampaign.spend) / 100).toFixed(2)}, Results ${yesterdayCampaign.actions || 0}. Spend ${spendChange}%, Results ${resultsChange}%.\n`;
    } else {
      context += '\n';
    }
  }

  return context;
}
