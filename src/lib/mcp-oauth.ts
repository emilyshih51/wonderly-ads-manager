/**
 * Minimal OAuth 2.1 authorization server for the read-only Growth MCP (`/api/mcp`).
 *
 * Just enough to satisfy an MCP client's OAuth flow (metadata discovery → dynamic client
 * registration → authorization-code + PKCE → bearer token): the *user* is authenticated by
 * the app's existing session (only someone logged into the dashboard can authorize), and
 * clients / codes / access tokens live in Redis. Public clients only (PKCE, no client
 * secret). Read-only scope — the tokens grant nothing but the MCP query tools.
 *
 * Redis is required (same store the sessions use); without it OAuth is disabled.
 */

import { createHash, randomBytes } from 'crypto';

import { getRedisClient } from '@/lib/redis';

const CLIENT_PREFIX = 'mcp:oauth:client:';
const CODE_PREFIX = 'mcp:oauth:code:';
const TOKEN_PREFIX = 'mcp:oauth:token:';

const CODE_TTL_SECONDS = 300; // auth code is short-lived
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // access token lasts 30 days
const CLIENT_TTL_SECONDS = 60 * 60 * 24 * 180; // registered client kept 180 days

/** App base URL (the OAuth issuer + resource host), e.g. https://wonderly-ads-manager.vercel.app */
export function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

/** The MCP resource this AS protects. */
export function mcpResource(): string {
  return `${baseUrl()}/api/mcp/mcp`;
}

interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
}

interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
}

/** A random URL-safe token. */
function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** base64url(SHA-256(input)) — for verifying a PKCE code_verifier against its challenge. */
export function s256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

/** Only Claude's own callback hosts may be used as redirect targets. */
export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);

    return (
      u.protocol === 'https:' &&
      (u.hostname === 'claude.ai' ||
        u.hostname === 'claude.com' ||
        u.hostname.endsWith('.claude.ai') ||
        u.hostname.endsWith('.claude.com'))
    );
  } catch {
    return false;
  }
}

/** Register a public client (dynamic client registration). Returns null if Redis is down. */
export async function registerClient(redirectUris: string[]): Promise<RegisteredClient | null> {
  const redis = await getRedisClient();

  if (!redis) return null;

  const client: RegisteredClient = { clientId: `mcp-${randomToken(12)}`, redirectUris };

  await redis.set(`${CLIENT_PREFIX}${client.clientId}`, JSON.stringify(client), {
    EX: CLIENT_TTL_SECONDS,
  });

  return client;
}

/** Look up a registered client. */
export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  const redis = await getRedisClient();

  if (!redis) return null;

  const raw = await redis.get(`${CLIENT_PREFIX}${clientId}`);

  return raw ? (JSON.parse(raw) as RegisteredClient) : null;
}

/** Mint and store a one-time authorization code. */
export async function issueCode(data: AuthCode): Promise<string | null> {
  const redis = await getRedisClient();

  if (!redis) return null;

  const code = randomToken();

  await redis.set(`${CODE_PREFIX}${code}`, JSON.stringify(data), { EX: CODE_TTL_SECONDS });

  return code;
}

/** Consume an authorization code (single-use): returns its data and deletes it. */
export async function consumeCode(code: string): Promise<AuthCode | null> {
  const redis = await getRedisClient();

  if (!redis) return null;

  const key = `${CODE_PREFIX}${code}`;
  const raw = await redis.get(key);

  if (!raw) return null;

  await redis.del(key);

  return JSON.parse(raw) as AuthCode;
}

/** Mint and store an access token for a user. */
export async function issueToken(
  userId: string
): Promise<{ token: string; expiresIn: number } | null> {
  const redis = await getRedisClient();

  if (!redis) return null;

  const token = randomToken();

  await redis.set(`${TOKEN_PREFIX}${token}`, JSON.stringify({ userId }), { EX: TOKEN_TTL_SECONDS });

  return { token, expiresIn: TOKEN_TTL_SECONDS };
}

/** True if the bearer token is a live OAuth access token. */
export async function isValidToken(token: string): Promise<boolean> {
  const redis = await getRedisClient();

  if (!redis) return false;

  return (await redis.get(`${TOKEN_PREFIX}${token}`)) !== null;
}

/** RFC 9728 protected-resource metadata (points clients at this AS). */
export function protectedResourceMetadata() {
  return { resource: mcpResource(), authorization_servers: [baseUrl()] };
}

/** RFC 8414 authorization-server metadata. */
export function authorizationServerMetadata() {
  const base = baseUrl();

  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}
