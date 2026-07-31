/**
 * OAuth authorization endpoint (authorization-code + PKCE).
 *
 * The USER is authenticated by the app's existing session — only someone logged into the
 * dashboard can authorize an MCP client. If there's no session we send them to /login (they
 * re-trigger the connector after signing in). On success we mint a one-time code bound to
 * the PKCE challenge and redirect back to the client's callback.
 */

import { NextResponse } from 'next/server';

import { baseUrl, getClient, isAllowedRedirect, issueCode } from '@/lib/mcp-oauth';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const responseType = p.get('response_type') ?? '';
  const clientId = p.get('client_id') ?? '';
  const redirectUri = p.get('redirect_uri') ?? '';
  const codeChallenge = p.get('code_challenge') ?? '';
  const method = p.get('code_challenge_method') ?? '';
  const state = p.get('state') ?? '';

  // Validate the client + redirect BEFORE trusting the redirect target.
  const client = clientId ? await getClient(clientId) : null;

  if (
    !client ||
    !redirectUri ||
    !client.redirectUris.includes(redirectUri) ||
    !isAllowedRedirect(redirectUri)
  ) {
    return new NextResponse('invalid_client_or_redirect_uri', { status: 400 });
  }

  const back = (params: Record<string, string>): NextResponse => {
    const u = new URL(redirectUri);

    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (state) u.searchParams.set('state', state);

    return NextResponse.redirect(u);
  };

  if (responseType !== 'code' || !codeChallenge || method !== 'S256') {
    return back({ error: 'invalid_request' });
  }

  const session = await getSession();

  if (!session) {
    // Not logged into the app — send them to sign in, then they retry the connector.
    return NextResponse.redirect(new URL('/login', baseUrl()));
  }

  const code = await issueCode({ clientId, redirectUri, codeChallenge, userId: session.id });

  return code ? back({ code }) : back({ error: 'server_error' });
}
