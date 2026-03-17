import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

/**
 * Rules are stored as individual cookies: wonderly_rule_{id}
 * This avoids the ~4KB single-cookie limit that breaks when storing
 * multiple rules with complex node configs.
 *
 * In production, switch to a proper database.
 */

const RULE_PREFIX = 'wonderly_rule_';

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  };
}

function getAllRules(cookieStore: Awaited<ReturnType<typeof cookies>>): any[] {
  const rules: any[] = [];
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith(RULE_PREFIX)) {
      try {
        rules.push(JSON.parse(cookie.value));
      } catch { /* skip malformed */ }
    }
  }
  // Sort by created_at descending (newest first)
  rules.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return rules;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = await cookies();
  const rules = getAllRules(cookieStore);

  return NextResponse.json({ data: rules });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const ruleId = `rule_${Date.now()}`;

    const newRule = {
      id: ruleId,
      user_id: session.id,
      name: body.name,
      is_active: body.is_active ?? false,
      nodes: body.nodes || [],
      edges: body.edges || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const cookieStore = await cookies();
    cookieStore.set(`${RULE_PREFIX}${ruleId}`, JSON.stringify(newRule), getCookieOptions());

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

    const cookieStore = await cookies();
    const existingCookie = cookieStore.get(`${RULE_PREFIX}${ruleId}`);

    if (!existingCookie) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    const existingRule = JSON.parse(existingCookie.value);
    const updatedRule = { ...existingRule, ...body, updated_at: new Date().toISOString() };

    cookieStore.set(`${RULE_PREFIX}${ruleId}`, JSON.stringify(updatedRule), getCookieOptions());

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
    const cookieStore = await cookies();
    cookieStore.delete(`${RULE_PREFIX}${ruleId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete rule error:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
