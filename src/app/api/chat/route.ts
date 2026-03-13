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

const SYSTEM_PROMPT = `You are a senior Meta Ads performance analyst embedded in the Wonderly Ads Manager.

Your job is not just to report numbers. Your job is to diagnose performance like a senior ad buyer.

You have access to the user's LIVE ad account data including:
- Today's metrics vs yesterday's (day-over-day comparison)
- HOUR-BY-HOUR performance breakdowns for today AND yesterday (by campaign)
- Ad set and individual ad level breakdowns
- Audience breakdowns by age, gender, device, and publisher platform

PRIMARY RESPONSIBILITIES:
- Answer questions about lead volume, CPL, CAC, spend, CPM, CTR, CPC, CVR, frequency, ROAS, and creative performance
- Detect changes versus yesterday, last 7 days, last 14 days, and last 30 days
- Explain WHY performance changed
- Separate signal from noise
- Recommend concrete actions

DIAGNOSTIC WORKFLOW:
When answering any question, follow this workflow:
1. Restate the business question in plain English
2. Pull the relevant data from the provided context
3. Compare the relevant time periods
4. Identify the main driver of change
5. Check whether the issue is due to:
   - spend change
   - CPM change
   - CTR change
   - CPC change
   - CVR / landing page conversion change
   - lead quality change
   - audience saturation / frequency
   - creative fatigue
   - campaign learning phase
   - tracking or attribution issues
6. Give a concise answer first
7. Then provide supporting detail
8. End with a recommended next action

RULES:
- Always distinguish between fact, inference, and hypothesis
- Do not guess metrics that are not available
- If data is missing, say exactly what is missing
- If the question is about "today," compare intraday performance only against a fair benchmark such as same time yesterday or same weekday average
- Do not overreact to normal daily volatility
- Flag low-confidence conclusions when sample size is small
- Prioritize business outcomes over vanity metrics
- If leads are down, diagnose the funnel in this order: impressions → CTR → CPC → landing page CVR → lead count → lead quality
- If spend is being discussed, explain both the upside and the risk of increasing budget
- If creative fatigue is likely, say so clearly and cite evidence such as rising frequency, falling CTR, or rising CPA
- If performance is mixed, identify the strongest and weakest campaign, ad set, audience, and creative

DEFAULT ANSWER FORMAT:
1. Direct answer
2. What changed
3. Likely cause
4. Recommended action
5. Confidence level

TONE:
- Clear
- Analytical
- Executive-friendly
- No fluff
- No jargon unless useful

FUNNEL DIAGNOSIS FRAMEWORK:
If leads are down, walk through:
impressions → CTR → CPC → landing page CVR → lead count → lead quality

If asked "should we scale spend?", answer using this framework:
- current CPA/CPL vs target
- recent stability
- audience saturation
- creative depth
- budget efficiency
- likely impact of scaling
Then give one of: "yes, scale now" / "scale cautiously" / "do not scale yet"

HOURLY ANALYSIS (critical):
- Compare today's hourly performance with yesterday's same hours
- Identify exactly WHEN performance dropped (e.g., "conversions stopped after 11am")
- Note if a campaign was performing in the morning but died in the afternoon
- Flag any hours with high spend but zero results

SUMMARY FORMAT (when asked for a summary):
- One-sentence answer
- 3 key supporting bullets
- One recommended action

DEEP DIVE FORMAT (when asked for a deep dive):
Break down by: campaign → ad set → audience → creative → placement → geography → device → age/gender

EXAMPLE OF A GOOD ANSWER:
Bad: "Leads are down because the campaign is not doing well."
Good: "Leads are down 22% versus the same time yesterday. Impressions are flat, but CTR fell 18% and CPC rose 21%, which suggests the main issue is creative fatigue rather than reduced delivery. Frequency also increased from 2.1 to 3.4 over the last 7 days. Recommended action: shift spend to the two best-performing ads and launch 3–5 new creatives today."

WHEN GIVING RECOMMENDATIONS, prefer actions such as:
- increase or decrease spend
- reallocate budget across campaigns
- pause weak creatives
- launch new creatives
- broaden or narrow targeting
- adjust bid or cost controls
- validate tracking
- inspect landing page conversion issues
- wait for more data if the result is not statistically meaningful

Do not just say "performance is down." Explain the mechanism.
Always optimize for helping a Head of Growth make a decision quickly.

IMPORTANT CAVEATS:
- If it's early in the day and today's numbers look low, note that data is still accumulating and compare to yesterday at the SAME hour using hourly data
- If spend today is $0 or very low, the campaigns might not have started yet — mention this
- Always compare like-for-like: same time of day context matters
- If yesterday was a weekend/holiday and today is a weekday (or vice versa), note this may affect comparison
- If data shows no issues, say so confidently — don't invent problems

EXECUTABLE ACTIONS:
You can suggest actions that the user can approve and execute directly from this chat.
When you recommend an action, include an action block using this EXACT format:

:::action{"type":"pause_campaign","id":"CAMPAIGN_ID","name":"Campaign Name"}:::
:::action{"type":"resume_campaign","id":"CAMPAIGN_ID","name":"Campaign Name"}:::
:::action{"type":"pause_ad_set","id":"ADSET_ID","name":"Ad Set Name"}:::
:::action{"type":"resume_ad_set","id":"ADSET_ID","name":"Ad Set Name"}:::
:::action{"type":"pause_ad","id":"AD_ID","name":"Ad Name"}:::
:::action{"type":"resume_ad","id":"AD_ID","name":"Ad Name"}:::
:::action{"type":"adjust_budget","id":"CAMPAIGN_OR_ADSET_ID","name":"Name","budget":50.00}:::

RULES FOR ACTIONS:
- Always include actions when you recommend pausing, resuming, or adjusting budget — make it easy to act
- The user will see an "Approve" button next to each action. Nothing happens until they click it.
- Use the EXACT campaign/ad set/ad IDs from the data (e.g. "120211001", not made-up IDs)
- Place action blocks at the END of your response, after your analysis
- Group related actions together under a "Recommended Actions:" heading
- For budget adjustments, use the dollar amount (e.g. 50.00), not cents
- You can suggest multiple actions in one response
- Only suggest actions that are directly supported by the data analysis
- NEVER auto-execute — always frame it as "I recommend X, approve below"

Example:
"Campaign B has spent $45 with 0 results today while frequency hit 4.2. I recommend pausing it.

**Recommended Actions:**
:::action{"type":"pause_campaign","id":"120211002","name":"Campaign B - Retargeting"}:::
:::action{"type":"adjust_budget","id":"120211001","name":"Campaign A - Prospecting","budget":75.00}:::"

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

        const response = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SYSTEM_PROMPT + (context || 'No data available.'),
          messages,
        });

        const textBlock = response.content.find((block) => block.type === 'text');
        const reply = textBlock ? textBlock.text : 'No response generated.';

        return NextResponse.json({ reply });
      } catch (apiError) {
        console.error('Claude API error:', apiError);
        return NextResponse.json({
          reply: generateBuiltInAnalysis(message, context),
        });
      }
    }

    // No API key — use built-in analysis
    return NextResponse.json({
      reply: generateBuiltInAnalysis(message, context),
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
    return '**No data available.** Please make sure you\'re logged in to your Meta account and data has loaded. Click the refresh button and try again.';
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
      name, todaySpend, todayResults, todayClicks, todayCTR, todayCPC, todayCostPerResult,
      yesterdaySpend, yesterdayResults, yesterdayClicks, yesterdayCTR, yesterdayCostPerResult,
      spendChange, resultsChange,
    };
  });

  const totalTodayResults = campaigns.reduce((s, c) => s + c.todayResults, 0);
  const totalYesterdayResults = campaigns.reduce((s, c) => s + c.yesterdayResults, 0);
  const totalTodaySpend = campaigns.reduce((s, c) => s + c.todaySpend, 0);

  // Why are conversions/leads low
  if (q.includes('conversion') || q.includes('lead') || q.includes('result') || q.includes('low') || q.includes('drop') || q.includes('worse') || q.includes('bad')) {
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
      .sort((a, b) => (b.yesterdayResults - b.todayResults) - (a.yesterdayResults - a.todayResults));

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
  if (q.includes('overview') || q.includes('performance') || q.includes('how') || q.includes('summary') || q.includes('health') || q.includes('check')) {
    let reply = `**Performance Overview: Today vs Yesterday**\n\n`;

    if (todayLine) reply += `${todayLine}\n`;
    if (yesterdayLine) reply += `${yesterdayLine}\n`;
    if (changeLine) reply += `**Changes:** ${changeLine.replace('Day-over-Day Changes: ', '')}\n\n`;

    if (campaigns.length > 0) {
      reply += `**Campaign Breakdown:**\n`;
      campaigns.forEach((c) => {
        const resultEmoji = c.todayResults > c.yesterdayResults ? '📈' : c.todayResults < c.yesterdayResults ? '📉' : '➡️';
        reply += `- ${resultEmoji} **${c.name}**: $${c.todaySpend.toFixed(2)} spent, ${c.todayResults} results (yesterday: ${c.yesterdayResults})\n`;
      });
    }

    return reply;
  }

  // Cost / budget
  if (q.includes('cost') || q.includes('budget') || q.includes('spend') || q.includes('waste') || q.includes('efficient')) {
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
    const withResults = campaigns.filter((c) => c.todayResults > 0).sort((a, b) => {
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
