import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Chat:Actions');

interface ActionPayload {
  type: string;
  id: string;
  name?: string;
  budget?: number;
}

/**
 * POST /api/chat/actions
 *
 * Executes a Meta action suggested by the Claude chat. Supported action types:
 * `pause_campaign`, `pause_ad_set`, `pause_ad`, `resume_campaign`,
 * `resume_ad_set`, `resume_ad`, `adjust_budget`. Body: `{ action: ActionPayload }`.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { action } = (await request.json()) as { action: ActionPayload };

    if (!action?.type || !action?.id) {
      return NextResponse.json({ error: 'Missing action type or ID' }, { status: 400 });
    }

    const meta = new MetaService(session.meta_access_token, session.ad_account_id);
    const label = action.name || action.id;

    const actionType = action.type.startsWith('pause')
      ? 'pause'
      : action.type.startsWith('resume')
        ? 'resume'
        : action.type === 'adjust_budget'
          ? 'update_budget'
          : null;

    if (!actionType) {
      return NextResponse.json({ error: `Unknown action type: ${action.type}` }, { status: 400 });
    }

    let dailyBudgetCents: number | undefined;

    if (actionType === 'update_budget') {
      if (!action.budget || action.budget <= 0) {
        return NextResponse.json({ error: 'Invalid budget amount' }, { status: 400 });
      }

      dailyBudgetCents = Math.round(action.budget) * 100;
    }

    await meta.executeAction(actionType, action.id, dailyBudgetCents);

    const result =
      actionType === 'pause'
        ? `✅ Paused "${label}"`
        : actionType === 'resume'
          ? `✅ Resumed "${label}"`
          : `✅ Set daily budget of "${label}" to $${Math.round(action.budget!).toFixed(2)}`;

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logger.error('Error', error);
    const message = error instanceof Error ? error.message : 'Action failed';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
