/**
 * Environment variable validation.
 *
 * Called at build time from `next.config.ts`. Throws if any required variable
 * is missing so the build (and `next dev`) fails fast with a clear message
 * rather than crashing at runtime mid-request.
 *
 * **Adding a new required variable:** append it to `REQUIRED_ENV_VARS` below.
 * Optional variables (those with safe defaults or graceful degradation) should
 * only be documented in `.env.example`, not added here.
 */

/** Variables that must be present for the application to function. */
const REQUIRED_ENV_VARS = [
  // Meta OAuth + API
  'META_APP_ID',
  'META_APP_SECRET',
  'META_SYSTEM_ACCESS_TOKEN',

  // App URL — used in OAuth redirect URIs
  'NEXT_PUBLIC_APP_URL',

  // Anthropic
  'ANTHROPIC_API_KEY',

  // Slack — needed for webhook signature verification and bot messages
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
] as const;

/**
 * Validate that all required environment variables are set.
 *
 * Throws an `Error` listing every missing variable if any are absent.
 * In production this prevents a partially-configured deployment from
 * silently failing at runtime; in development it surfaces missing
 * `.env.local` entries immediately on `next dev` startup.
 *
 * @throws {Error} If one or more required variables are missing.
 */
export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `\n\nMissing required environment variables:\n\n` +
        missing.map((k) => `  ❌  ${k}`).join('\n') +
        `\n\nSee .env.example for descriptions. Set these in your .env.local (dev) or Vercel dashboard (production).\n`
    );
  }
}
