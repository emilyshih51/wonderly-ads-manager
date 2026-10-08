import { NextResponse } from 'next/server';
import { MetaApiError } from '@/services/meta/types';

/**
 * Returns a NextResponse with the appropriate status code for Meta API errors.
 * - Rate limit errors (code 17, 32, 80004) → 429
 * - All other errors → 500
 */
export function metaErrorResponse(error: unknown, fallbackMessage = 'Request failed') {
  const isRateLimit = isMetaRateLimit(error);

  return NextResponse.json(
    { error: isRateLimit ? 'rate limit' : fallbackMessage },
    { status: isRateLimit ? 429 : 500 }
  );
}

/**
 * True when a Meta error is a rate limit ("User request limit reached" and friends):
 * codes 4 (app), 17 (user), 32 (page), 613 (call-specific), or the ads-insights
 * throttling subcodes 80004 / 2446079.
 */
export function isMetaRateLimit(error: unknown): boolean {
  return (
    (error instanceof MetaApiError &&
      ([4, 17, 32, 613].includes(error.metaError.code ?? -1) ||
        error.metaError.error_subcode === 80004 ||
        error.metaError.error_subcode === 2446079)) ||
    (error instanceof Error &&
      (error.message.includes('request limit') || error.message.includes('too many')))
  );
}
