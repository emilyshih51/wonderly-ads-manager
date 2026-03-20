import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { generateMockChatData } from './mock';
import { createLogger } from '@/services/logger';

const logger = createLogger('Chat:Data');

/**
 * GET /api/chat/data
 *
 * Aggregates ad performance data for the Claude chat context. Fetches
 * today/yesterday metrics at campaign, ad set, ad, and account levels,
 * plus 30-day daily history and demographic breakdowns. Falls back to
 * mock data when USE_MOCK_DATA is set or no real data is returned.
 */
export async function GET(request: NextRequest) {
  const useMock =
    process.env.USE_MOCK_DATA === 'true' || request.nextUrl.searchParams.get('mock') === 'true';

  if (useMock) {
    logger.info('Using mock data for AI testing');

    return NextResponse.json(generateMockChatData());
  }

  const session = await getSession();

  if (!session) {
    logger.info('No session — falling back to mock data');

    return NextResponse.json(generateMockChatData());
  }

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now);

  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const thirtyDaysAgo = new Date(now);

  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  try {
    const results = await Promise.allSettled([
      meta.getCampaignLevelInsights('today'),
      meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'campaign'),
      meta.getAdSetLevelInsights('today'),
      meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'adset'),
      meta.getAdLevelInsights('today'),
      meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'ad'),
      meta.getHourlyInsights('today', 'campaign'),
      meta.getHourlyInsightsForDate(yesterdayStr, yesterdayStr, 'campaign'),
      meta.getAccountInsights('today'),
      meta.getInsightsForDateRange(yesterdayStr, yesterdayStr, 'account'),
      meta.getInsightsWithBreakdowns('today', 'age,gender'),
      meta.getInsightsWithBreakdowns('today', 'device_platform'),
      meta.getInsightsWithBreakdowns('today', 'publisher_platform'),
      meta.getCampaignOptimizationMap(),
      meta.getDailyInsights('last_30d', 'account'),
      meta.getDailyInsights('last_30d', 'campaign'),
      meta.getDailyInsights('last_7d', 'adset'),
      meta.getDailyInsights('last_7d', 'ad'),
    ]);

    const extract = (index: number) => {
      const r = results[index];

      if (r.status === 'fulfilled') return (r.value as { data?: unknown[] })?.data || [];

      return [];
    };

    const optimizationMap =
      results[13].status === 'fulfilled' ? (results[13].value as Record<string, string>) : {};

    const response = {
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
        adDaily: extract(17),
      },
      breakdowns: {
        ageGender: extract(10),
        device: extract(11),
        publisher: extract(12),
      },
    };

    const hasAnyData =
      response.today.campaigns.length > 0 ||
      response.yesterday.campaigns.length > 0 ||
      response.today.account.length > 0 ||
      response.history.accountDaily.length > 0;

    if (!hasAnyData) {
      logger.info('No real data returned — falling back to mock data');

      return NextResponse.json(generateMockChatData());
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Error fetching data', error);

    return NextResponse.json(generateMockChatData());
  }
}
