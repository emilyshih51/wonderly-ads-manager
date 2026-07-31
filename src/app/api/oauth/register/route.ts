/**
 * Dynamic Client Registration (RFC 7591) for the MCP OAuth flow.
 * A client (e.g. Claude) POSTs its `redirect_uris`; we register a public client (PKCE, no
 * secret) and return its `client_id`. Only Claude's own callback hosts are accepted.
 */

import { isAllowedRedirect, registerClient } from '@/lib/mcp-oauth';

export const runtime = 'nodejs';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { redirect_uris?: unknown };
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const valid = uris.filter((u): u is string => typeof u === 'string' && isAllowedRedirect(u));

  if (valid.length === 0) {
    return Response.json({ error: 'invalid_redirect_uri' }, { status: 400, headers: CORS });
  }

  const client = await registerClient(valid);

  if (!client) {
    return Response.json({ error: 'server_error' }, { status: 503, headers: CORS });
  }

  return Response.json(
    {
      client_id: client.clientId,
      redirect_uris: valid,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    },
    { status: 201, headers: CORS }
  );
}

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}
