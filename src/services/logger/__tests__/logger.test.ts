/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger } from '@/services/logger';
import { LOG_LEVEL_WEIGHT } from '@/services/logger/constants';

describe('LOG_LEVEL_WEIGHT', () => {
  it('has correct ordering', () => {
    expect(LOG_LEVEL_WEIGHT.debug).toBeLessThan(LOG_LEVEL_WEIGHT.info);
    expect(LOG_LEVEL_WEIGHT.info).toBeLessThan(LOG_LEVEL_WEIGHT.warn);
    expect(LOG_LEVEL_WEIGHT.warn).toBeLessThan(LOG_LEVEL_WEIGHT.error);
  });
});

// In the test environment (NODE_ENV=test), the logger treats it as production
// and emits single-line JSON. We test the structural output via JSON.parse.
describe('Logger (server prod/test mode)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a JSON entry with correct scope and message', () => {
    const logger = createLogger('Test');

    logger.info('hello world');

    expect(console.info).toHaveBeenCalledOnce();
    const raw = (console.info as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string;
    const entry = JSON.parse(raw);

    expect(entry.scope).toBe('Test');
    expect(entry.message).toBe('hello world');
    expect(entry.level).toBe('info');
  });

  it('includes data field in JSON entry', () => {
    const logger = createLogger('Test');

    logger.warn('something happened', { key: 'value' });

    const raw = (console.warn as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string;
    const entry = JSON.parse(raw);

    expect(entry.data).toEqual({ key: 'value' });
  });

  it('emits a single argument (the JSON string)', () => {
    const logger = createLogger('Test');

    logger.info('no data');

    const call = (console.info as ReturnType<typeof vi.spyOn>).mock.calls[0];

    expect(call).toHaveLength(1);
  });

  it('calls console.error for .error()', () => {
    const logger = createLogger('Test');

    logger.error('boom');

    expect(console.error).toHaveBeenCalledOnce();
  });

  it('calls console.debug for .debug()', () => {
    const logger = createLogger('Test', { minLevel: 'debug' });

    logger.debug('verbose');

    expect(console.debug).toHaveBeenCalledOnce();
  });
});

describe('Logger — level filtering', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppresses calls below minLevel', () => {
    const logger = createLogger('Test', { minLevel: 'warn' });

    logger.debug('silent');
    logger.info('also silent');
    logger.warn('visible');
    logger.error('also visible');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('emits all levels when minLevel is debug', () => {
    const logger = createLogger('Test', { minLevel: 'debug' });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(console.debug).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });
});

// isBrowser is a module-level constant frozen at import time (typeof window !== 'undefined').
// In Vitest (jsdom or node), window is undefined, so the server path is always used.
// We verify the browser emitBrowser logic indirectly: the JSON output from the server path
// still contains the scope and message, so the structural contract is the same.
describe('Logger — JSON output structure (server/test env)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('JSON entry has scope matching constructor argument', () => {
    const logger = new Logger('MyService');

    logger.info('test message');

    const raw = (console.info as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string;
    const entry = JSON.parse(raw);

    expect(entry.scope).toBe('MyService');
    expect(entry.message).toBe('test message');
  });

  it('JSON entry has data field for non-Error values', () => {
    const logger = new Logger('MyService');

    logger.error('failed', { code: 500 });

    const raw = (console.error as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string;
    const entry = JSON.parse(raw);

    expect(entry.data).toEqual({ code: 500 });
    expect(entry.error).toBeUndefined();
  });
});
