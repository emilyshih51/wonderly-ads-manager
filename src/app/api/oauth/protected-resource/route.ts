/**
 * OAuth protected-resource metadata (RFC 9728) for the MCP.
 * Served at `/.well-known/oauth-protected-resource` via a rewrite; points clients at this
 * app as the authorization server. Public + CORS so any MCP client can discover it.
 */

import { protectedResourceMetadata } from '@/lib/mcp-oauth';

export const runtime = 'nodejs';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

export function GET() {
  return Response.json(protectedResourceMetadata(), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}
