import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

// In production, use a database. For now, using cookies/memory store
const RULES_COOKIE = 'wonderly_automation_rules';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cookieStore = await cookies();
  const rulesCookie = cookieStore.get(RULES_COOKIE);
  const rules = rulesCookie ? JSON.parse(rulesCookie.value) : [];

  return NextResponse.json({ data: rules });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const cookieStore = await cookies();
    const rulesCookie = cookieStore.get(RULES_COOKIE);
    const rules = rulesCookie ? JSON.parse(rulesCookie.value) : [];

    const newRule = {
      id: `rule_${Date.now()}`,
      user_id: session.id,
      name: body.name,
      is_active: body.is_active ?? true,
      nodes: body.nodes || [],
      edges: body.edges || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    rules.push(newRule);

    cookieStore.set(RULES_COOKIE, JSON.stringify(rules), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

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
    const cookieStore = await cookies();
    const rulesCookie = cookieStore.get(RULES_COOKIE);
    const rules = rulesCookie ? JSON.parse(rulesCookie.value) : [];

    const index = rules.findIndex((r: { id: string }) => r.id === body.id);
    if (index === -1) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    rules[index] = { ...rules[index], ...body, updated_at: new Date().toISOString() };

    cookieStore.set(RULES_COOKIE, JSON.stringify(rules), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

    return NextResponse.json(rules[index]);
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
    const rulesCookie = cookieStore.get(RULES_COOKIE);
    let rules = rulesCookie ? JSON.parse(rulesCookie.value) : [];

    rules = rules.filter((r: { id: string }) => r.id !== ruleId);

    cookieStore.set(RULES_COOKIE, JSON.stringify(rules), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete rule error:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
