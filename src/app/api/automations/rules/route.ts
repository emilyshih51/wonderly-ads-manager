import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  getAllRules,
  getRule,
  saveRule,
  deleteRule,
  isKvConfigured,
  StoredRule,
} from '@/lib/rules-store';

/**
 * Rules are stored in Vercel KV (persistent Redis).
 * This allows the cron job at /api/automations/evaluate to read
 * active rules without browser cookies.
 *
 * Setup: Create a KV database in Vercel Dashboard → Storage → Create → KV
 */

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allRules = await getAllRules();
  // Filter rules for the current ad account (rules without ad_account_id are shown to all — legacy rules)
  const rules = allRules.filter((r) => !r.ad_account_id || r.ad_account_id === session.ad_account_id);
  return NextResponse.json({ data: rules, kv_configured: isKvConfigured() });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const ruleId = `rule_${Date.now()}`;

    const newRule: StoredRule = {
      id: ruleId,
      user_id: session.id,
      ad_account_id: session.ad_account_id, // Tag rule with current account
      name: body.name,
      is_active: body.is_active ?? false,
      nodes: body.nodes || [],
      edges: body.edges || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await saveRule(newRule);
    return NextResponse.json(newRule);
  } catch (error) {
    console.error('Create rule error:', error);
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const ruleId = body.id;
    if (!ruleId) return NextResponse.json({ error: 'Rule ID required' }, { status: 400 });

    const existingRule = await getRule(ruleId);
    if (!existingRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    const updatedRule: StoredRule = {
      ...existingRule,
      ...body,
      updated_at: new Date().toISOString(),
    };

    await saveRule(updatedRule);
    return NextResponse.json(updatedRule);
  } catch (error) {
    console.error('Update rule error:', error);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ruleId = request.nextUrl.searchParams.get('id');
  if (!ruleId) return NextResponse.json({ error: 'Rule ID required' }, { status: 400 });

  try {
    await deleteRule(ruleId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete rule error:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
