import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { updateStatus, metaApi } from '@/lib/meta-api';

/**
 * POST /api/chat/actions
 *
 * Executes an AI-suggested action after user approval.
 * Actions: pause_campaign, resume_campaign, adjust_budget,
 *          pause_ad_set, resume_ad_set, pause_ad, resume_ad
 */

interface ActionPayload {
  type: string;
  id: string;        // Meta object ID (campaign, ad set, or ad)
  name?: string;     // Human-readable name for logging
  budget?: number;   // For budget adjustments
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { action } = await request.json() as { action: ActionPayload };
    if (!action?.type || !action?.id) {
      return NextResponse.json({ error: 'Missing action type or ID' }, { status: 400 });
    }

    const { meta_access_token } = session;
    let result: string;

    switch (action.type) {
      case 'pause_campaign':
      case 'pause_ad_set':
      case 'pause_ad': {
        await updateStatus(action.id, meta_access_token, 'PAUSED');
        result = `✅ Paused "${action.name || action.id}"`;
        break;
      }

      case 'resume_campaign':
      case 'resume_ad_set':
      case 'resume_ad': {
        await updateStatus(action.id, meta_access_token, 'ACTIVE');
        result = `✅ Resumed "${action.name || action.id}"`;
        break;
      }

      case 'adjust_budget': {
        if (!action.budget || action.budget <= 0) {
          return NextResponse.json({ error: 'Invalid budget amount' }, { status: 400 });
        }
        // Meta API expects budget in cents
        const budgetCents = Math.round(action.budget * 100).toString();
        await metaApi(`/${action.id}`, meta_access_token, {
          method: 'POST',
          body: { daily_budget: budgetCents },
        });
        result = `✅ Set daily budget of "${action.name || action.id}" to $${action.budget.toFixed(2)}`;
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
