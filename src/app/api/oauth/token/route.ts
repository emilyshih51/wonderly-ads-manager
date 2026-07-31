/**
 * OAuth token endpoint — exchanges an authorization code (+ PKCE verifier) for a bearer
 * access token. Public client (no secret): security comes from PKCE and the one-time code.
 * The token is opaque and stored in Redis; the MCP validates it by lookup.
 */

import { consumeCode, issueToken, s256 } from '@/lib/mcp-oauth';

export const runtime = 'nodejs';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

export async function POST(req: Request) {
  // Token requests are form-urlencoded per the spec; accept JSON as a fallback.
  const params = await readParams(req);
  const get = (k: string) => params[k] ?? '';

  if (get('grant_type') !== 'authorization_code') {
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400, headers: CORS });
  }

  const data = await consumeCode(get('code'));

  if (!data || data.redirectUri !== get('redirect_uri') || data.clientId !== get('client_id')) {
    return Response.json({ error: 'invalid_grant' }, { status: 400, headers: CORS });
  }

  const verifier = get('code_verifier');

  if (!verifier || s256(verifier) !== data.codeChallenge) {
    return Response.json({ error: 'invalid_grant' }, { status: 400, headers: CORS });
  }

  const tok = await issueToken(data.userId);

  if (!tok) {
    return Response.json({ error: 'server_error' }, { status: 503, headers: CORS });
  }

  return Response.json(
    {
      access_token: tok.token,
      token_type: 'Bearer',
      expires_in: tok.expiresIn,
      scope: 'growth:read',
    },
    { headers: CORS }
  );
}

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

/** Read the request body as form-urlencoded, falling back to JSON. */
async function readParams(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]));
  }

  const form = await req.formData().catch(() => null);
  const out: Record<string, string> = {};

  if (form) for (const [k, v] of form.entries()) out[k] = String(v);

  return out;
}
