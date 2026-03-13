import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
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
} from '@/lib/meta-api';
import { generateMockChatData } from './mock';

/**
 * GET /api/chat/data
 *
 * Fetches comprehensive multi-period ad data for the AI Chat.
 * Returns today, yesterday (with hourly breakdowns), breakdowns — everything
 * Claude needs to do deep hourly performance diagnosis.
 *
 * Set USE_MOCK_DATA=true in .env.local to use realistic mock data
 * for testing the AI Chat without a Meta connection.
 */
export async function GET(request: NextRequest) {
  // Check for mock mode
  const useMock = process.env.USE_MOCK_DATA === 'true'
    || request.nextUrl.searchParams.get('mock') === 'true';

  if (useMock) {
    console.log('[Chat Data] Using mock data for AI testing');
    return NextResponse.json(generateMockChatData());
  }

  const session = await getSession();
  if (!session) {
    console.log('[Chat Data] No session — falling back to mock data');
    return NextResponse.json(generateMockChatData());
  }

  const { ad_account_id, meta_access_token } = session;

  // Calculate date strings
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  try {
    // Fetch all data in parallel for speed
    const results = await Promise.allSettled([
      // 0: Today's campaign-level insights (totals)
      getCampaignLevelInsights(ad_account_id, meta_access_token, 'today'),
      // 1: Yesterday's campaign-level insights (totals)
      getInsightsForDateRange(ad_account_id, meta_access_token, yesterdayStr, yesterdayStr, 'campaign'),
      // 2: Today's ad set-level insights
      getAdSetLevelInsights(ad_account_id, meta_access_token, 'today'),
      // 3: Yesterday's ad set-level insights
      getInsightsForDateRange(ad_account_id, meta_access_token, yesterdayStr, yesterdayStr, 'adset'),
      // 4: Today's ad-level insights
      getAdLevelInsights(ad_account_id, meta_access_token, 'today'),
      // 5: Yesterday's ad-level insights
      getInsightsForDateRange(ad_account_id, meta_access_token, yesterdayStr, yesterdayStr, 'ad'),
      // 6: TODAY hourly breakdown (campaign level) — hour-by-hour for today
      getHourlyInsights(ad_account_id, meta_access_token, 'today', 'campaign'),
      // 7: YESTERDAY hourly breakdown (campaign level) — for comparison
      getHourlyInsightsForDate(ad_account_id, meta_access_token, yesterdayStr, yesterdayStr, 'campaign'),
      // 8: Today's account-level totals
      getAccountInsights(ad_account_id, meta_access_token, 'today'),
      // 9: Yesterday's account-level totals
      getInsightsForDateRange(ad_account_id, meta_access_token, yesterdayStr, yesterdayStr, 'account'),
      // 10: Age/gender breakdown (today)
      getInsightsWithBreakdowns(ad_account_id, meta_access_token, 'today', 'age,gender'),
      // 11: Device platform breakdown (today)
      getInsightsWithBreakdowns(ad_account_id, meta_access_token, 'today', 'device_platform'),
      // 12: Publisher platform breakdown (today)
      getInsightsWithBreakdowns(ad_account_id, meta_access_token, 'today', 'publisher_platform'),
      // 13: Campaign optimization mapping (campaign_id → result action type)
      getCampaignOptimizationMap(ad_account_id, meta_access_token),
    ]);

    const extract = (index: number) => {
      const r = results[index];
      if (r.status === 'fulfilled') return r.value?.data || [];
      return [];
    };

    // Optimization map is a plain object, not an array with .data
    const optimizationMap = results[13].status === 'fulfilled'
      ? results[13].value as Record<string, string>
      : {};

    const response = {
      date: { today: todayStr, yesterday: yesterdayStr },
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
      breakdowns: {
        ageGender: extract(10),
        device: extract(11),
        publisher: extract(12),
      },
    };

    // If all data is empty (Meta API issues), fall back to mock
    const hasAnyData = response.today.campaigns.length > 0
      || response.yesterday.campaigns.length > 0
      || response.today.account.length > 0;

    if (!hasAnyData) {
      console.log('[Chat Data] No real data returned — falling back to mock data');
      return NextResponse.json(generateMockChatData());
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Chat Data] Error fetching data:', error);
    return NextResponse.json(generateMockChatData());
  }
}
