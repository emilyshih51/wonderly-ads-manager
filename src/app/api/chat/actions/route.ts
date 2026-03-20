import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';

interface ActionPayload {
  type: string;
  id: string;
  name?: string;
  budget?: number;
}

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
    let result: string;

    switch (action.type) {
      case 'pause_campaign':
      case 'pause_ad_set':

      case 'pause_ad': {
        await meta.updateStatus(action.id, 'PAUSED');
        result = `✅ Paused "${action.name || action.id}"`;
        break;
      }

      case 'resume_campaign':
      case 'resume_ad_set':

      case 'resume_ad': {
        await meta.updateStatus(action.id, 'ACTIVE');
        result = `✅ Resumed "${action.name || action.id}"`;
        break;
      }

      case 'adjust_budget': {
        if (!action.budget || action.budget <= 0) {
          return NextResponse.json({ error: 'Invalid budget amount' }, { status: 400 });
        }

        const wholeBudget = Math.round(action.budget);
        const budgetCents = (wholeBudget * 100).toString();

        await meta.request(`/${action.id}`, {
          method: 'POST',
          body: { daily_budget: budgetCents },
        });
        result = `✅ Set daily budget of "${action.name || action.id}" to $${wholeBudget.toFixed(2)}`;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action type: ${action.type}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[Chat Action] Error:', error);
    const message = error instanceof Error ? error.message : 'Action failed';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
