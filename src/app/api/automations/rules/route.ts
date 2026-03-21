import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';
import { getRedisClient } from '@/lib/redis';
import { RulesStoreService, type StoredRule } from '@/services/rules-store';
import { createLogger } from '@/services/logger';

const logger = createLogger('Automations:Rules');

async function createRulesStore(): Promise<RulesStoreService> {
  const [redis, cookieStore] = await Promise.all([getRedisClient(), cookies()]);

  return new RulesStoreService(redis, cookieStore);
}

export async function GET(_request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  logger.info('GET /api/automations/rules');

  const store = await createRulesStore();
  const allRules = await store.getAll();
  // Filter rules for the current ad account (rules without ad_account_id are shown to all — legacy rules)
  const rules = allRules.filter(
    (r) => !r.ad_account_id || r.ad_account_id === session.ad_account_id
  );

  return NextResponse.json({ data: rules, kv_configured: !!process.env.REDIS_URL });
}

export async function POST(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  logger.info('POST /api/automations/rules');

  try {
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }

    if (!Array.isArray(body.nodes)) {
      return NextResponse.json({ error: 'nodes must be an array' }, { status: 400 });
    }

    if (!Array.isArray(body.edges)) {
      return NextResponse.json({ error: 'edges must be an array' }, { status: 400 });
    }

    const validNodeTypes = new Set(['trigger', 'condition', 'action']);

    for (const node of body.nodes) {
      if (!node?.id || !node?.type || !validNodeTypes.has(node.type)) {
        return NextResponse.json(
          { error: 'Each node must have an id and a valid type (trigger, condition, action)' },
          { status: 400 }
        );
      }
    }

    for (const edge of body.edges) {
      if (!edge?.id || !edge?.source || !edge?.target) {
        return NextResponse.json(
          { error: 'Each edge must have id, source, and target' },
          { status: 400 }
        );
      }
    }

    const ruleId = `rule_${crypto.randomUUID()}`;

    const newRule: StoredRule = {
      id: ruleId,
      user_id: session.id,
      ad_account_id: session.ad_account_id,
      name: body.name,
      is_active: body.is_active ?? false,
      nodes: body.nodes || [],
      edges: body.edges || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const store = await createRulesStore();

    await store.save(newRule);

    return NextResponse.json(newRule, { status: 201 });
  } catch (error) {
    logger.error('Create rule error', error);

    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  logger.info('PUT /api/automations/rules');

  try {
    const body = await request.json();
    const ruleId = body.id;

    if (!ruleId) return NextResponse.json({ error: 'Rule ID required' }, { status: 400 });

    const store = await createRulesStore();
    const existingRule = await store.get(ruleId);

    if (!existingRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    if (existingRule.user_id && existingRule.user_id !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updatedRule: StoredRule = {
      ...existingRule,
      name: body.name ?? existingRule.name,
      is_active: body.is_active ?? existingRule.is_active,
      nodes: body.nodes ?? existingRule.nodes,
      edges: body.edges ?? existingRule.edges,
      updated_at: new Date().toISOString(),
    };

    await store.save(updatedRule);

    return NextResponse.json(updatedRule);
  } catch (error) {
    logger.error('Update rule error', error);

    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const result = await requireSession();

  if (result instanceof NextResponse) return result;
  const session = result;

  logger.info('DELETE /api/automations/rules');

  const ruleId = request.nextUrl.searchParams.get('id');

  if (!ruleId) return NextResponse.json({ error: 'Rule ID required' }, { status: 400 });

  try {
    const store = await createRulesStore();
    const existingRule = await store.get(ruleId);

    if (existingRule?.user_id && existingRule.user_id !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await store.delete(ruleId);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Delete rule error', error);

    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
