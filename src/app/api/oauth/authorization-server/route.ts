/**
 * OAuth authorization-server metadata (RFC 8414) for the MCP.
 * Served at `/.well-known/oauth-authorization-server` via a rewrite. Advertises the
 * authorize / token / register endpoints and PKCE (S256). Public + CORS for discovery.
 */

import { authorizationServerMetadata } from '@/lib/mcp-oauth';

export const runtime = 'nodejs';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

export function GET() {
  return Response.json(authorizationServerMetadata(), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}
