import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchAdContextData } from '@/lib/slack-context';
import { generateMockChatData } from './mock';
import { createLogger } from '@/services/logger';

const logger = createLogger('Chat:Data');

/**
 * GET /api/chat/data
 *
 * Aggregates ad performance data for the Claude chat context. Falls back to
 * mock data when USE_MOCK_DATA is set or no real data is returned.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const useMock =
    process.env.USE_MOCK_DATA === 'true' || request.nextUrl.searchParams.get('mock') === 'true';

  if (useMock) {
    logger.info('Using mock data for AI testing');

    return NextResponse.json(generateMockChatData());
  }

  try {
    const data = await fetchAdContextData(session.ad_account_id, session.meta_access_token);

    const hasAnyData =
      data.today.campaigns.length > 0 ||
      data.yesterday.campaigns.length > 0 ||
      data.today.account.length > 0 ||
      data.history.accountDaily.length > 0;

    if (!hasAnyData) {
      logger.info('No real data returned — falling back to mock data');

      return NextResponse.json(generateMockChatData());
    }

    return NextResponse.json({
      date: data.date,
      optimizationMap: data.optimizationMap,
      today: data.today,
      yesterday: data.yesterday,
      history: {
        accountDaily: data.history.accountDaily,
        campaignDaily: data.history.campaignDaily,
        adsetDaily: data.history.adsetDaily,
      },
      breakdowns: data.breakdowns,
    });
  } catch (error) {
    logger.error('Error fetching data', error);

    return NextResponse.json(generateMockChatData());
  }
}
