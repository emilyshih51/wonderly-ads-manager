import { NextResponse } from 'next/server';
import { MetaApiError } from '@/services/meta/types';

/**
 * Returns a NextResponse with the appropriate status code for Meta API errors.
 * - Rate limit errors (code 17, 32, 80004) → 429
 * - All other errors → 500
 */
export function metaErrorResponse(error: unknown, fallbackMessage = 'Request failed') {
  const isRateLimit =
    (error instanceof MetaApiError &&
      (error.metaError.code === 17 ||
        error.metaError.code === 32 ||
        error.metaError.error_subcode === 80004 ||
        error.metaError.error_subcode === 2446079)) ||
    (error instanceof Error &&
      (error.message.includes('request limit') || error.message.includes('too many')));

  return NextResponse.json(
    { error: isRateLimit ? 'rate limit' : fallbackMessage },
    { status: isRateLimit ? 429 : 500 }
  );
}
