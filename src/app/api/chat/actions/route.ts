import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { metaErrorResponse } from '@/lib/meta-error-response';
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
  const start = Date.now();

  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { action } = (await request.json()) as { action: ActionPayload };

    logger.info('POST /api/chat/actions', { type: action?.type, id: action?.id });

    if (!action?.type || !action?.id) {
      return NextResponse.json({ error: 'Missing action type or ID' }, { status: 400 });
    }

    const meta = MetaService.fromSession(session);
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

      // Safety: reject budgets over $50,000/day — likely a hallucinated number
      if (action.budget > 50_000) {
        return NextResponse.json(
          { error: `Budget of $${action.budget} exceeds safety limit of $50,000/day` },
          { status: 400 }
        );
      }

      // Safety: reject fractional budgets (should be whole dollars per system prompt)
      if (action.budget !== Math.round(action.budget)) {
        return NextResponse.json(
          { error: 'Budget must be a whole dollar amount' },
          { status: 400 }
        );
      }

      dailyBudgetCents = Math.round(action.budget) * 100;
    }

    // Safety: validate that the ID looks like a Meta object ID (numeric string)
    if (!/^\d+$/.test(action.id)) {
      return NextResponse.json({ error: `Invalid Meta object ID: ${action.id}` }, { status: 400 });
    }

    await meta.executeAction(actionType, action.id, dailyBudgetCents);

    const result =
      actionType === 'pause'
        ? `✅ Paused "${label}"`
        : actionType === 'resume'
          ? `✅ Resumed "${label}"`
          : `✅ Set daily budget of "${label}" to $${Math.round(action.budget!).toFixed(2)}`;

    logger.info('Action executed', { result, durationMs: Date.now() - start });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logger.error('Action execution error', error);

    return metaErrorResponse(error, 'Action failed');
  }
}
