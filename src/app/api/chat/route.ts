import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AI Chat API — powered by Claude (Anthropic)
 *
 * Sends comprehensive multi-period ad data as context so Claude can
 * perform deep diagnostic analysis (today vs yesterday, trends, breakdowns).
 *
 * Falls back to a built-in rule-based engine if no API key is configured.
 */

export const SYSTEM_PROMPT = `You are the performance marketing expert inside Wonderly Ads Manager.

You talk like a real media buyer — direct, conversational, no corporate speak. You're talking to teammates in Slack or chat, not writing a consulting report.

VOICE & TONE:
- Talk like a person, not an AI. No "CRITICAL INSIGHT:", no "Situation:", no "Root Cause:", no structured templates.
- Just say what matters. Lead with the number, then explain why.
- Be conversational. "Campaign A did 12 results at $23 each today — that's solid" not "The data indicates Campaign A generated 12 conversions at a cost per acquisition of $23.08."
- Never say "the real story is", "let me break this down", "here's what's interesting", "great question" or other filler phrases.
- Never use headers like **CRITICAL INSIGHT** or **Situation** or **Root Cause** or **Decision**. Just talk.
- Short paragraphs. No walls of text. Get to the point.
- Be opinionated — say what you'd actually do, not "you might consider."
- It's fine to say "I'd pause this" or "this is burning money" or "leave it alone, it's fine."

PARTIAL DAY DATA — THIS IS CRITICAL:
- Today's data is ALWAYS a partial day. The day is not over. Never compare today's totals to yesterday's full-day totals as if they're apples-to-apples.
- If someone asks "how are we doing today?" and spend is lower than yesterday, that's EXPECTED — the day isn't finished.
- To compare fairly: use hourly data to compare the same hours, or just note "it's [time] and we've spent $X so far vs $Y full day yesterday."
- NEVER frame normal partial-day numbers as a "drop" or "decline" or "budget cut." If it's 2pm and we've spent half of yesterday's total, that's on track.
- Only flag a real problem if the RATE is off (e.g., CPA is 2x worse, CTR collapsed, zero results with meaningful spend).

DATA YOU HAVE ACCESS TO:
- Today vs yesterday (campaign, ad set, ad level)
- Hourly breakdowns for today and yesterday
- Audience breakdowns (age, gender, device, platform)
- Last 30 days daily data (account + campaign level)
- Last 7 days ad set daily data

HOW TO ANALYZE:
- Start with the answer to what they asked. Don't restate the question.
- Numbers first, then interpretation.
- Compare rates (CPA, CTR, CPC) not just totals when comparing partial vs full days.
- If something is actually fine, say it's fine. Don't invent problems.
- If something is actually bad, be direct about it and suggest an action.
- When diagnosing issues, think through: spend → CPM → CTR → CPC → conversion rate → frequency → creative fatigue.
- Use the 30-day history to spot trends. Don't just look at today vs yesterday.

ACTIONS:
You can suggest actions users can approve with one click. Use this format:

:::action{"type":"pause_campaign","id":"CAMPAIGN_ID","name":"Campaign Name"}:::
:::action{"type":"resume_campaign","id":"CAMPAIGN_ID","name":"Campaign Name"}:::
:::action{"type":"pause_ad_set","id":"ADSET_ID","name":"Ad Set Name"}:::
:::action{"type":"resume_ad_set","id":"ADSET_ID","name":"Ad Set Name"}:::
:::action{"type":"pause_ad","id":"AD_ID","name":"Ad Name"}:::
:::action{"type":"resume_ad","id":"AD_ID","name":"Ad Name"}:::
:::action{"type":"adjust_budget","id":"CAMPAIGN_OR_ADSET_ID","name":"Name","budget":500}:::

Rules for actions:
- Include action blocks whenever you recommend pausing, resuming, or changing budget. Use real IDs from the data.
- Put actions at the end, under "Recommended actions:" (lowercase, no bold headers)
- Nothing executes until the user clicks approve.
- Only suggest actions backed by the data — don't suggest things just to seem proactive.

BUDGET RULES — CRITICAL:
- Budget values MUST always be whole dollar amounts. Never use decimals like $591.00 — use $600 or $550 instead.
- When the user says "raise budget by $X" or "increase by $X", you must calculate: NEW budget = CURRENT budget + X. Look at the campaign/ad set data to find the current daily budget, add the requested increment, and round to the nearest whole dollar.
- When the user says "lower budget by $X", calculate: NEW budget = CURRENT budget - X.
- When setting budgets, always use clean round numbers: $50, $100, $150, $200, $250, $300, $350, $400, $450, $500, etc.
- NEVER set a fractional budget like $591.00 or $423.50. Round to the nearest $50 if unsure.
- The "budget" field in the action block is the NEW TOTAL daily budget, not the increment.

EXAMPLE OF GOOD RESPONSE:
"Campaign A did 12 results today at $23 CPA on $277 spend so far. Yesterday it finished with 51 results at $12.60 — but the day's not over yet, so the total will climb.

The rate is a bit worse though. $23 vs $12.60 per result yesterday. Worth watching but not alarming yet — could just be early-day variance. If it's still above $20 by end of day, might be time to refresh creatives.

Campaign C is the one I'd actually worry about. $206 spent, 7 results at $29 each, and yesterday was even worse ($435 for 1 result). That's been consistently bad.

Recommended actions:
:::action{"type":"pause_campaign","id":"120211003","name":"Campaign C"}:::"

EXAMPLE OF BAD RESPONSE (never do this):
"**CRITICAL INSIGHT**: Campaign A generated 12 results today, down 76% from yesterday's 51 results.

**Situation**: Campaign "Wonderly | Prospecting | Website Signup (A)" delivered 12 results today...

**Root Cause**: The massive drop is primarily due to spend being cut by 57%..."

That reads like ChatGPT wrote a report. Don't do it. Just talk normally.

Here is the user's current Meta Ads account data:
`;

export async function POST(request: NextRequest) {
  try {
    const { message, context, history } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (anthropicKey) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey });

        const messages: Anthropic.MessageParam[] = [
          ...(history || []).map((h: { role: string; content: string }) => ({
            role: h.role as 'user' | 'assistant',
            content: h.content,
          })),
          { role: 'user', content: message },
        ];

        const stream = await client.messages.stream({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SYSTEM_PROMPT + (context || 'No data available.'),
          messages,
        });

        // Create a ReadableStream that sends SSE formatted data
        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of stream) {
                if (event.type === 'content_block_delta') {
                  const delta = event.delta as { type: string; text?: string };
                  if (delta.type === 'text_delta' && delta.text) {
                    const data = JSON.stringify({ text: delta.text });
                    controller.enqueue(`data: ${data}\n\n`);
                  }
                }
              }
              controller.enqueue('data: [DONE]\n\n');
              controller.close();
            } catch (error) {
              console.error('Stream error:', error);
              controller.error(error);
            }
          },
        });

        return new NextResponse(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      } catch (apiError) {
        console.error('Claude API error:', apiError);
        // Fallback to built-in analysis on API error
        const reply = generateBuiltInAnalysis(message, context);
        const readable = new ReadableStream({
          start(controller) {
            const data = JSON.stringify({ text: reply });
            controller.enqueue(`data: ${data}\n\n`);
            controller.enqueue('data: [DONE]\n\n');
            controller.close();
          },
        });

        return new NextResponse(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }
    }

    // No API key — use built-in analysis, stream the response
    const reply = generateBuiltInAnalysis(message, context);
    const readable = new ReadableStream({
      start(controller) {
        const data = JSON.stringify({ text: reply });
        controller.enqueue(`data: ${data}\n\n`);
        controller.enqueue('data: [DONE]\n\n');
        controller.close();
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}

/**
 * Built-in analysis engine — works without an API key.
 * Parses the rich context string and does basic comparison analysis.
 */
function generateBuiltInAnalysis(question: string, context: string): string {
  const q = question.toLowerCase();

  if (!context || context.includes('No account data')) {
    return "**No data available.** Please make sure you're logged in to your Meta account and data has loaded. Click the refresh button and try again.";
  }

  // Parse account overview
  const todayLine = context.split('\n').find((l) => l.startsWith('Today:'));
  const yesterdayLine = context.split('\n').find((l) => l.startsWith('Yesterday:'));
  const changeLine = context.split('\n').find((l) => l.startsWith('Day-over-Day'));

  // Parse campaigns
  const campaignLines = context.split('\n').filter((l) => l.startsWith('Campaign "'));

  interface ParsedCampaign {
    name: string;
    todaySpend: number;
    todayResults: number;
    todayClicks: number;
    todayCTR: string;
    todayCPC: string;
    todayCostPerResult: string;
    yesterdaySpend: number;
    yesterdayResults: number;
    yesterdayClicks: number;
    yesterdayCTR: string;
    yesterdayCostPerResult: string;
    spendChange: string;
    resultsChange: string;
  }

  const campaigns: ParsedCampaign[] = campaignLines.map((line) => {
    const name = line.match(/Campaign "([^"]+)"/)?.[1] || 'Unknown';
    const todaySpend = parseFloat(line.match(/TODAY Spend \$([\d.]+)/)?.[1] || '0');
    const todayResults = parseInt(line.match(/TODAY.*?Results (\d+)/)?.[1] || '0');
    const todayClicks = parseInt(line.match(/TODAY.*?Clicks (\d+)/)?.[1] || '0');
    const todayCTR = line.match(/TODAY.*?CTR ([\d.]+)%/)?.[1] || '0';
    const todayCPC = line.match(/TODAY.*?CPC \$([\d.]+)/)?.[1] || '0';
    const todayCostPerResult = line.match(/TODAY.*?Cost\/Result \$([\d.]+)/)?.[1] || 'N/A';
    const yesterdaySpend = parseFloat(line.match(/YESTERDAY Spend \$([\d.]+)/)?.[1] || '0');
    const yesterdayResults = parseInt(line.match(/YESTERDAY.*?Results (\d+)/)?.[1] || '0');
    const yesterdayClicks = parseInt(line.match(/YESTERDAY.*?Clicks (\d+)/)?.[1] || '0');
    const yesterdayCTR = line.match(/YESTERDAY.*?CTR ([\d.]+)%/)?.[1] || '0';
    const yesterdayCostPerResult = line.match(/YESTERDAY.*?Cost\/Result \$([\d.]+)/)?.[1] || 'N/A';
    const resultsChange = line.match(/Results ([+-][∞\d.]+%)/)?.[1] || '0%';
    const spendChange = line.match(/Spend ([+-][∞\d.]+%)/)?.[1] || '0%';

    return {
      name,
      todaySpend,
      todayResults,
      todayClicks,
      todayCTR,
      todayCPC,
      todayCostPerResult,
      yesterdaySpend,
      yesterdayResults,
      yesterdayClicks,
      yesterdayCTR,
      yesterdayCostPerResult,
      spendChange,
      resultsChange,
    };
  });

  const totalTodayResults = campaigns.reduce((s, c) => s + c.todayResults, 0);
  const totalYesterdayResults = campaigns.reduce((s, c) => s + c.yesterdayResults, 0);
  const totalTodaySpend = campaigns.reduce((s, c) => s + c.todaySpend, 0);

  // Why are conversions/leads low
  if (
    q.includes('conversion') ||
    q.includes('lead') ||
    q.includes('result') ||
    q.includes('low') ||
    q.includes('drop') ||
    q.includes('worse') ||
    q.includes('bad')
  ) {
    let reply = `**Conversion Diagnosis: Today vs Yesterday**\n\n`;

    if (totalTodayResults === 0 && totalTodaySpend === 0) {
      reply += `No spend or results recorded today yet. Your campaigns may not have started delivering, or it's still early in the day. Check back later or verify your campaigns are active.\n`;
      if (totalYesterdayResults > 0) {
        reply += `\nFor reference, yesterday you had **${totalYesterdayResults} results** across all campaigns.\n`;
      }
      return reply;
    }

    if (changeLine) {
      reply += `**Account-level changes:** ${changeLine.replace('Day-over-Day Changes: ', '')}\n\n`;
    }

    reply += `**Today:** ${totalTodayResults} results from $${totalTodaySpend.toFixed(2)} spend\n`;
    reply += `**Yesterday:** ${totalYesterdayResults} results from ${campaigns.reduce((s, c) => s + c.yesterdaySpend, 0).toFixed(2)} spend\n\n`;

    // Find biggest drops
    const droppedCampaigns = campaigns
      .filter((c) => c.yesterdayResults > 0 && c.todayResults < c.yesterdayResults)
      .sort((a, b) => b.yesterdayResults - b.todayResults - (a.yesterdayResults - a.todayResults));

    if (droppedCampaigns.length > 0) {
      reply += `**Campaigns with declining results:**\n`;
      droppedCampaigns.forEach((c) => {
        const drop = c.yesterdayResults - c.todayResults;
        reply += `- **${c.name}**: ${c.todayResults} results today vs ${c.yesterdayResults} yesterday (↓${drop}). CTR: ${c.todayCTR}% today vs ${c.yesterdayCTR}% yesterday.\n`;
      });
      reply += '\n';
    }

    // Find spending but no results
    const wasteful = campaigns.filter((c) => c.todaySpend > 5 && c.todayResults === 0);
    if (wasteful.length > 0) {
      reply += `**Spending without results:**\n`;
      wasteful.forEach((c) => {
        reply += `- **${c.name}**: $${c.todaySpend.toFixed(2)} spent, 0 results. Consider pausing.\n`;
      });
      reply += '\n';
    }

    reply += `**Quick actions:**\n`;
    reply += `1. Check if any campaigns were paused or had budget changes\n`;
    reply += `2. Look at ad fatigue — same creatives running too long?\n`;
    reply += `3. Verify your pixel/conversion tracking is working\n`;

    return reply;
  }

  // Overview / performance
  if (
    q.includes('overview') ||
    q.includes('performance') ||
    q.includes('how') ||
    q.includes('summary') ||
    q.includes('health') ||
    q.includes('check')
  ) {
    let reply = `**Performance Overview: Today vs Yesterday**\n\n`;

    if (todayLine) reply += `${todayLine}\n`;
    if (yesterdayLine) reply += `${yesterdayLine}\n`;
    if (changeLine) reply += `**Changes:** ${changeLine.replace('Day-over-Day Changes: ', '')}\n\n`;

    if (campaigns.length > 0) {
      reply += `**Campaign Breakdown:**\n`;
      campaigns.forEach((c) => {
        const resultEmoji =
          c.todayResults > c.yesterdayResults
            ? '📈'
            : c.todayResults < c.yesterdayResults
              ? '📉'
              : '➡️';
        reply += `- ${resultEmoji} **${c.name}**: $${c.todaySpend.toFixed(2)} spent, ${c.todayResults} results (yesterday: ${c.yesterdayResults})\n`;
      });
    }

    return reply;
  }

  // Cost / budget
  if (
    q.includes('cost') ||
    q.includes('budget') ||
    q.includes('spend') ||
    q.includes('waste') ||
    q.includes('efficient')
  ) {
    let reply = `**Cost Analysis**\n\n`;
    reply += `Total spend today: **$${totalTodaySpend.toFixed(2)}**\n\n`;

    const sorted = [...campaigns].sort((a, b) => b.todaySpend - a.todaySpend);
    sorted.forEach((c) => {
      reply += `- **${c.name}**: $${c.todaySpend.toFixed(2)} spent, ${c.todayResults} results, Cost/Result: $${c.todayCostPerResult}, CPC: $${c.todayCPC}\n`;
    });

    return reply;
  }

  // Scale / best
  if (q.includes('scale') || q.includes('best') || q.includes('top') || q.includes('winner')) {
    const withResults = campaigns
      .filter((c) => c.todayResults > 0)
      .sort((a, b) => {
        const aCPR = parseFloat(a.todayCostPerResult) || Infinity;
        const bCPR = parseFloat(b.todayCostPerResult) || Infinity;
        return aCPR - bCPR;
      });

    let reply = `**Top Performers (by Cost per Result)**\n\n`;
    if (withResults.length === 0) {
      reply += `No campaigns with results today yet. Check back later or look at yesterday's data.\n`;
    } else {
      withResults.forEach((c, i) => {
        reply += `${i + 1}. **${c.name}**: $${c.todayCostPerResult}/result, ${c.todayResults} results, $${c.todaySpend.toFixed(2)} spend\n`;
      });
    }
    return reply;
  }

  // Default
  let reply = `**Your Account Today**\n\n`;
  reply += `- **${campaigns.length}** campaigns tracked\n`;
  reply += `- **$${totalTodaySpend.toFixed(2)}** total spend\n`;
  reply += `- **${totalTodayResults}** total results (yesterday: ${totalYesterdayResults})\n\n`;
  reply += `Try asking:\n`;
  reply += `- "Why are my conversions low today?"\n`;
  reply += `- "Give me a performance overview"\n`;
  reply += `- "Which campaigns should I scale?"\n`;
  reply += `- "Where am I wasting budget?"\n`;
  reply += `- "Run a health check"\n`;

  return reply;
}
