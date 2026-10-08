import { describe, expect, it, vi } from 'vitest';

import {
  AutopauseRateLimitError,
  RATE_LIMIT_MESSAGE,
  withRateLimitRetry,
} from '@/lib/winners-autopause-runner';
import { MetaApiError } from '@/services/meta/types';

const rateLimited = () => new MetaApiError({ message: 'User request limit reached', code: 17 });

describe('withRateLimitRetry', () => {
  it('returns the result when Meta is fine', async () => {
    await expect(withRateLimitRetry(async () => 42, 0)).resolves.toBe(42);
  });

  it('retries once after a rate limit and succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValueOnce('ok');

    await expect(withRateLimitRetry(fn, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives a plain-English error when still rate limited', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimited());

    await expect(withRateLimitRetry(fn, 0)).rejects.toBeInstanceOf(AutopauseRateLimitError);
    await expect(withRateLimitRetry(fn, 0)).rejects.toThrow(RATE_LIMIT_MESSAGE);
  });

  it('does not retry other errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withRateLimitRetry(fn, 0)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
