import { NextRequest, NextResponse, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  verifySlackSignature,
  postSlackMessage,
  buildSlackBlocks,
  parseActions,
  stripActions,
  getThreadMessages,
} from '@/lib/slack';
import { SYSTEM_PROMPT } from '@/app/api/chat/route';

// Allow up to 60 seconds for this function (Claude + Meta API calls take time)
export const maxDuration = 60;
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
  getCampaigns,
  getAdAccount,
} from '@/lib/meta-api';
import { generateMockChatData } from '@/app/api/chat/data/mock';

/**
 * POST /api/slack/events
 *
 * Slack Events API webhook
 * - Handles URL verification
 * - Handles app_mention events (when bot is @mentioned)
 * - Responds within 3 seconds
 */

// Simple in-memory deduplication to prevent Slack retries from triggering duplicate processing
const processedEvents = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000; // 60 seconds

function isDuplicateEvent(eventId: string): boolean {
  // Clean up old entries
  const now = Date.now();
  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_WINDOW_MS) processedEvents.delete(id);
  }
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

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

  // Handle URL verification challenge FIRST (before signature check)
  // Slack sends this during initial setup and needs the challenge echoed back
  if (body.type === 'url_verification') {
    console.log('[Slack Events] URL verification challenge');
    return NextResponse.json({ challenge: body.challenge });
  }

  // Verify Slack signature for all other requests
  const slackSignature = request.headers.get('x-slack-signature') || '';
  const slackTimestamp = request.headers.get('x-slack-request-timestamp') || '';
  const isValid = verifySlackSignature(slackSignature, slackTimestamp, rawBody);

  if (!isValid) {
    console.warn('[Slack Events] Invalid signature');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Handle app_mention event
  if (body.type === 'event_callback' && body.event?.type === 'app_mention') {
    const event = body.event;
    const eventId = body.event_id || `${event.channel}_${event.ts}`;

    // Deduplicate — Slack retries if it doesn't get a fast 200
    if (isDuplicateEvent(eventId)) {
      console.log('[Slack Events] Duplicate event, skipping:', eventId);
      return NextResponse.json({ ok: true });
    }

    console.log('[Slack Events] Received app_mention:', {
      channel: event.channel,
      user: event.user,
      text: event.text,
    });

    // Use after() to process in the background — keeps the serverless function alive
    // while returning 200 to Slack immediately (avoids 3-second timeout)
    after(async () => {
      try {
        await processAppMention(event);
      } catch (error) {
        console.error('[Slack Events] Background processing error:', error);
      }
    });

    return NextResponse.json({ ok: true });
  }

  // Ignore other event types
  return NextResponse.json({ ok: true });
}

async function processAppMention(event: any) {
  const channelId = event.channel;
  const threadTs = event.thread_ts || event.ts;

  // Extract the actual question (remove @bot mention)
  let question = event.text.replace(/<@.+?>/g, '').trim();

  if (!question) {
    question = 'Give me a performance overview';
  }

  try {
    // Fetch ad data using system access token (no session needed)
    const metaSystemToken = process.env.META_SYSTEM_ACCESS_TOKEN;
    // Support multiple accounts: META_AD_ACCOUNT_IDS (comma-separated) or single META_AD_ACCOUNT_ID
    const accountIdsRaw = process.env.META_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_ID || '';
    const accountIds = accountIdsRaw
      .split(',')
      .map((id) => id.trim().replace(/^act_/, ''))
      .filter(Boolean);

    if (!metaSystemToken || accountIds.length === 0) {
      console.warn('[Slack Events] Missing META_SYSTEM_ACCESS_TOKEN or META_AD_ACCOUNT_ID(S)');
      await postSlackMessage(
        channelId,
        'Sorry, the Slack integration is not fully configured. Please set META_SYSTEM_ACCESS_TOKEN and META_AD_ACCOUNT_ID in your environment.',
        undefined,
        threadTs
      );
      return;
    }

    // Fetch ad data for ALL accounts and thread history in parallel
    const [threadHistory, ...contextResults] = await Promise.all([
      getThreadMessages(channelId, threadTs),
      ...accountIds.map((id) => fetchAdContextData(id, metaSystemToken)),
    ]);

    // Combine context from all accounts
    let contextText = '';
    for (let i = 0; i < accountIds.length; i++) {
      const data = contextResults[i] as any;
      if (accountIds.length > 1) {
        const accountName = data?.accountName || `Account ${accountIds[i]}`;
        contextText += `\n\n===== AD ACCOUNT: ${accountName} (ID: ${accountIds[i]}) =====\n`;
      }
      contextText += formatContextForClaude(data);
    }

    // Send to Claude
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let analysisText = '';

    if (anthropicKey) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey });

        // Build message history from thread for conversation memory
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        for (const msg of threadHistory) {
          messages.push({ role: msg.role, content: msg.text });
        }
        // Add the current question
        messages.push({ role: 'user', content: question });

        const message = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SYSTEM_PROMPT + contextText,
          messages,
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

    // Post as a threaded reply to the original message
    await postSlackMessage(channelId, cleanText, blocks, threadTs);
  } catch (error) {
    console.error('[Slack Events] Error processing mention:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await postSlackMessage(
      channelId,
      `Sorry, I encountered an error: ${errorMsg}`,
      undefined,
      threadTs
    );
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
      // [17] Fetch campaign objects with daily_budget for budget adjustment context
      getCampaigns(adAccountId, accessToken),
      // [18] Fetch ad account name
      getAdAccount(adAccountId, accessToken),
    ]);

    const extract = (index: number) => {
      const r = results[index];
      if (r.status === 'fulfilled') return r.value?.data || [];
      return [];
    };

    const optimizationMap =
      results[13].status === 'fulfilled' ? (results[13].value as Record<string, string>) : {};

    const accountInfo = results[18].status === 'fulfilled' ? results[18].value : null;

    return {
      accountName: accountInfo?.name || `Account ${adAccountId}`,
      date: { today: todayStr, yesterday: yesterdayStr, thirtyDaysAgo: thirtyDaysAgoStr },
      optimizationMap,
      campaignObjects: extract(17), // Campaign objects with daily_budget
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
 * Extract the result count from a Meta insights row's actions array.
 * Meta returns actions as [{action_type: "offsite_conversion.fb_pixel_lead", value: "5"}, ...]
 */
function getResultsFromRow(row: any, optimizationMap?: Record<string, string>): number {
  if (!row.actions || !Array.isArray(row.actions)) return 0;
  const campaignId = row.campaign_id;
  const resultType = campaignId && optimizationMap?.[campaignId];

  // If we know the specific optimization event, ONLY look for that — don't fall through
  // This matches the dashboard's getResults() behavior exactly
  if (resultType) {
    const found = row.actions.find((a: any) => a.action_type === resultType);
    return found ? parseInt(found.value) || 0 : 0;
  }

  // Only use generic fallback for campaigns NOT in the optimization map
  // Exclude engagement-only actions (link_click, page_engagement, etc.) to match dashboard
  const conversion = row.actions.find(
    (a: any) =>
      (a.action_type.startsWith('offsite_conversion.') ||
        a.action_type.startsWith('onsite_conversion.') ||
        a.action_type === 'lead' ||
        a.action_type === 'complete_registration') &&
      // Exclude engagement actions that aren't true conversions
      !a.action_type.includes('post_engagement') &&
      !a.action_type.includes('page_engagement') &&
      !a.action_type.includes('link_click')
  );
  return conversion ? parseInt(conversion.value) || 0 : 0;
}

function getCostPerResult(row: any, optimizationMap?: Record<string, string>): string {
  const results = getResultsFromRow(row, optimizationMap);
  if (results === 0) return 'N/A';
  return (parseFloat(row.spend) / results).toFixed(2);
}

/**
 * Format ad data for Claude context — comprehensive, matching the web chat quality
 */
function formatContextForClaude(data: any): string {
  const sections: string[] = [];
  const optMap = data.optimizationMap || {};

  // Tell Claude what time it is so it knows today's data is partial
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });
  const dayStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  sections.push(
    `CURRENT TIME: ${timeStr} PT on ${dayStr}. Today's data is PARTIAL — the day is not over. Do not compare today's totals to yesterday's full-day totals as a "drop."\n`
  );

  // Account totals — compute results by summing campaign-level results (using optimization map)
  // This matches the dashboard's methodology instead of picking a random action_type at account level
  const todayAcct = data.today.account?.[0];
  const yesterdayAcct = data.yesterday.account?.[0];

  const todayCampaignResults = (data.today.campaigns || []).reduce(
    (sum: number, c: any) => sum + getResultsFromRow(c, optMap),
    0
  );
  const yesterdayCampaignResults = (data.yesterday.campaigns || []).reduce(
    (sum: number, c: any) => sum + getResultsFromRow(c, optMap),
    0
  );

  if (todayAcct) {
    const spend = parseFloat(todayAcct.spend);
    const costPerResult =
      todayCampaignResults > 0 ? (spend / todayCampaignResults).toFixed(2) : 'N/A';
    sections.push(
      `ACCOUNT TODAY: Spend $${spend.toFixed(2)}, Impressions ${todayAcct.impressions || 0}, Clicks ${todayAcct.clicks || 0}, CTR ${(parseFloat(todayAcct.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(todayAcct.cpc) || 0).toFixed(2)}, Results ${todayCampaignResults}, Cost/Result $${costPerResult}, CPM $${(parseFloat(todayAcct.cpm) || 0).toFixed(2)}`
    );
  }
  if (yesterdayAcct) {
    const spend = parseFloat(yesterdayAcct.spend);
    const costPerResult =
      yesterdayCampaignResults > 0 ? (spend / yesterdayCampaignResults).toFixed(2) : 'N/A';
    sections.push(
      `ACCOUNT YESTERDAY: Spend $${spend.toFixed(2)}, Impressions ${yesterdayAcct.impressions || 0}, Clicks ${yesterdayAcct.clicks || 0}, CTR ${(parseFloat(yesterdayAcct.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(yesterdayAcct.cpc) || 0).toFixed(2)}, Results ${yesterdayCampaignResults}, Cost/Result $${costPerResult}, CPM $${(parseFloat(yesterdayAcct.cpm) || 0).toFixed(2)}`
    );
  }

  // Campaign breakdown — today vs yesterday
  sections.push('\n--- CAMPAIGNS (TODAY vs YESTERDAY) ---');
  const allCampaignIds = new Set<string>();
  for (const c of [...(data.today.campaigns || []), ...(data.yesterday.campaigns || [])]) {
    allCampaignIds.add(c.campaign_id);
  }

  // Build a map of campaign_id -> daily_budget from campaign objects
  const budgetMap: Record<string, string> = {};
  for (const c of data.campaignObjects || []) {
    if (c.daily_budget) budgetMap[c.id] = `$${(parseInt(c.daily_budget) / 100).toFixed(0)}`;
  }

  for (const cid of allCampaignIds) {
    const t = (data.today.campaigns || []).find((c: any) => c.campaign_id === cid);
    const y = (data.yesterday.campaigns || []).find((c: any) => c.campaign_id === cid);
    const name = t?.campaign_name || y?.campaign_name || cid;
    const dailyBudget = budgetMap[cid] || 'N/A';

    let line = `Campaign "${name}" (ID: ${cid}, Daily Budget: ${dailyBudget}):`;
    if (t) {
      const tResults = getResultsFromRow(t, optMap);
      line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${tResults}, Cost/Result $${getCostPerResult(t, optMap)}, Clicks ${t.clicks}, CTR ${(parseFloat(t.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(t.cpc) || 0).toFixed(2)}, Frequency ${t.frequency || 'N/A'}`;
    } else {
      line += ' TODAY: No data yet';
    }
    if (y) {
      const yResults = getResultsFromRow(y, optMap);
      line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${yResults}, Cost/Result $${getCostPerResult(y, optMap)}, Clicks ${y.clicks}, CTR ${(parseFloat(y.ctr) || 0).toFixed(2)}%`;
    } else {
      line += ' | YESTERDAY: No data';
    }
    sections.push(line);
  }

  // Ad Set breakdown
  if (data.today.adSets?.length > 0 || data.yesterday.adSets?.length > 0) {
    sections.push('\n--- AD SETS (TODAY vs YESTERDAY) ---');
    const allAdSetIds = new Set<string>();
    for (const a of [...(data.today.adSets || []), ...(data.yesterday.adSets || [])]) {
      allAdSetIds.add(a.adset_id);
    }
    for (const asid of allAdSetIds) {
      const t = (data.today.adSets || []).find((a: any) => a.adset_id === asid);
      const y = (data.yesterday.adSets || []).find((a: any) => a.adset_id === asid);
      const name = t?.adset_name || y?.adset_name || asid;
      let line = `Ad Set "${name}" (ID: ${asid}):`;
      if (t) {
        line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResultsFromRow(t, optMap)}, Clicks ${t.clicks}, CTR ${(parseFloat(t.ctr) || 0).toFixed(2)}%`;
      }
      if (y) {
        line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResultsFromRow(y, optMap)}, Clicks ${y.clicks}`;
      }
      sections.push(line);
    }
  }

  // Ad breakdown — today vs yesterday
  if (data.today.ads?.length > 0 || data.yesterday.ads?.length > 0) {
    sections.push('\n--- ADS (TODAY vs YESTERDAY) ---');
    const allAdIds = new Set<string>();
    for (const a of [...(data.today.ads || []), ...(data.yesterday.ads || [])]) {
      allAdIds.add(a.ad_id);
    }
    for (const adId of allAdIds) {
      const t = (data.today.ads || []).find((a: any) => a.ad_id === adId);
      const y = (data.yesterday.ads || []).find((a: any) => a.ad_id === adId);
      const name = t?.ad_name || y?.ad_name || adId;
      const cid = t?.campaign_id || y?.campaign_id;
      let line = `Ad "${name}" (ID: ${adId}, campaign ${cid}):`;
      if (t) {
        line += ` TODAY Spend $${parseFloat(t.spend).toFixed(2)}, Results ${getResultsFromRow(t, optMap)}, Clicks ${t.clicks}, CTR ${(parseFloat(t.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(t.cpc) || 0).toFixed(2)}`;
      } else {
        line += ' TODAY: No data';
      }
      if (y) {
        line += ` | YESTERDAY Spend $${parseFloat(y.spend).toFixed(2)}, Results ${getResultsFromRow(y, optMap)}, Clicks ${y.clicks}`;
      }
      sections.push(line);
    }
  }

  // Historical daily data (last 30 days account level)
  if (data.history?.accountDaily?.length > 0) {
    sections.push('\n--- DAILY ACCOUNT PERFORMANCE (LAST 30 DAYS) ---');
    for (const row of data.history.accountDaily) {
      const results = getResultsFromRow(row);
      sections.push(
        `${row.date_start}: Spend $${parseFloat(row.spend).toFixed(2)}, Results ${results}, Clicks ${row.clicks}, CTR ${(parseFloat(row.ctr) || 0).toFixed(2)}%, CPC $${(parseFloat(row.cpc) || 0).toFixed(2)}`
      );
    }
  }

  // Breakdowns
  if (data.breakdowns?.ageGender?.length > 0) {
    sections.push('\n--- AUDIENCE BREAKDOWN (TODAY) ---');
    for (const row of data.breakdowns.ageGender) {
      sections.push(
        `${row.age || '?'} ${row.gender || '?'}: Spend $${parseFloat(row.spend).toFixed(2)}, Clicks ${row.clicks}, CTR ${(parseFloat(row.ctr) || 0).toFixed(2)}%`
      );
    }
  }

  return sections.join('\n');
}
