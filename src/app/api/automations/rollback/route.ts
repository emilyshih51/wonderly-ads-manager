import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { MetaService } from '@/services/meta';
import { createLogger } from '@/services/logger';

const logger = createLogger('Automations:Rollback');

/**
 * POST /api/automations/rollback
 *
 * Reverses the pause/activate actions from a single automation history run.
 * Accepts a list of results from a history event and calls the inverse
 * Meta action for each reversible entry:
 * - `paused` → `ACTIVE`
 * - `activated` → `PAUSED`
 * - `promoted` → pause the duplicated ad (original is already paused)
 *
 * Body: `{ results: Array<{ entity_id, action }> }`
 *
 * Only reverses live actions — dry-run (`would_*`) entries are ignored.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as {
    results?: Array<{ entity_id?: string; action?: string; duplicated_ad_id?: string }>;
  };

  if (!Array.isArray(body.results) || body.results.length === 0) {
    return NextResponse.json({ error: 'No results provided' }, { status: 400 });
  }

  const meta = new MetaService(session.meta_access_token, session.ad_account_id);
  const reversed: Array<{ entity_id: string; action: string }> = [];
  const skipped: Array<{ entity_id: string; reason: string }> = [];
  const errors: Array<{ entity_id: string; error: string }> = [];

  for (const result of body.results) {
    const entityId = result.entity_id;
    const action = result.action;

    if (!entityId || !action) continue;

    // Skip dry-run entries — they didn't actually change anything
    if (action.startsWith('would_')) {
      skipped.push({ entity_id: entityId, reason: 'dry_run' });
      continue;
    }

    try {
      if (action === 'paused') {
        await meta.updateStatus(entityId, 'ACTIVE');
        reversed.push({ entity_id: entityId, action: 'reactivated' });
      } else if (action === 'activated') {
        await meta.updateStatus(entityId, 'PAUSED');
        reversed.push({ entity_id: entityId, action: 're-paused' });
      } else if (action === 'promoted' && result.duplicated_ad_id) {
        // Pause the duplicated ad that was created by the promote action
        await meta.updateStatus(result.duplicated_ad_id, 'PAUSED');
        reversed.push({ entity_id: result.duplicated_ad_id, action: 'paused_duplicate' });
      } else {
        skipped.push({ entity_id: entityId, reason: `no_inverse_for_${action}` });
      }
    } catch (err) {
      logger.error(`Rollback failed for entity ${entityId}`, err);
      errors.push({ entity_id: entityId, error: String(err) });
    }
  }

  return NextResponse.json({ reversed, skipped, errors });
}
