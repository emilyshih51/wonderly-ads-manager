import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
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
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  const body = (await request.json()) as {
    results?: Array<{ entity_id?: string; action?: string; duplicated_ad_id?: string }>;
  };

  if (!Array.isArray(body.results) || body.results.length === 0) {
    return NextResponse.json({ error: 'No results provided' }, { status: 400 });
  }

  const MAX_ROLLBACK_ACTIONS = 50;

  if (body.results.length > MAX_ROLLBACK_ACTIONS) {
    return NextResponse.json(
      { error: `Too many results (max ${MAX_ROLLBACK_ACTIONS})` },
      { status: 400 }
    );
  }

  const meta = MetaService.fromSession(session);
  const reversed: Array<{ entity_id: string; action: string }> = [];
  const skipped: Array<{ entity_id: string; reason: string }> = [];
  const errors: Array<{ entity_id: string; error: string }> = [];

  // Build list of rollback operations, skipping non-reversible entries
  const operations: Array<{
    entityId: string;
    targetStatus: 'ACTIVE' | 'PAUSED';
    resultAction: string;
  }> = [];

  for (const result of body.results) {
    const entityId = result.entity_id;
    const action = result.action;

    if (!entityId || !action) continue;

    if (action.startsWith('would_')) {
      skipped.push({ entity_id: entityId, reason: 'dry_run' });
    } else if (action === 'paused') {
      operations.push({ entityId, targetStatus: 'ACTIVE', resultAction: 'reactivated' });
    } else if (action === 'activated') {
      operations.push({ entityId, targetStatus: 'PAUSED', resultAction: 're-paused' });
    } else if (action === 'promoted' && result.duplicated_ad_id) {
      operations.push({
        entityId: result.duplicated_ad_id,
        targetStatus: 'PAUSED',
        resultAction: 'paused_duplicate',
      });
    } else {
      skipped.push({ entity_id: entityId, reason: `no_inverse_for_${action}` });
    }
  }

  // Execute rollback operations in parallel batches of 5 to avoid Meta rate limits
  const BATCH_SIZE = 5;

  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = operations.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((op) => meta.updateStatus(op.entityId, op.targetStatus))
    );

    for (let j = 0; j < results.length; j++) {
      const op = batch[j];
      const result = results[j];

      if (result.status === 'fulfilled') {
        reversed.push({ entity_id: op.entityId, action: op.resultAction });
      } else {
        logger.error(`Rollback failed for entity ${op.entityId}`, result.reason);
        errors.push({ entity_id: op.entityId, error: String(result.reason) });
      }
    }
  }

  return NextResponse.json({ reversed, skipped, errors });
}
