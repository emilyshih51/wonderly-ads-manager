/**
 * Logger — lightweight scoped logger for server-side routes and client components.
 *
 * Server (Node.js / Edge): structured JSON in production, colored output in development.
 * Client (browser): plain console methods — no ANSI codes, no JSON serialization.
 *
 * @example
 * ```ts
 * const logger = createLogger('Slack');
 * logger.info('Message sent', { channel, ts });
 * logger.error('Failed to post', error);
 * ```
 */
/* eslint-disable no-console */

import { LOG_LEVEL_WEIGHT, LEVEL_COLOR, ANSI, DEFAULT_MIN_LEVEL, DEV_MIN_LEVEL } from './constants';
import type { LogLevel, LogEntry, LoggerOptions } from './types';

export type { LogLevel, LogEntry, LoggerOptions };

// Safe for Edge Runtime and browser — avoids any Node.js-only globals.
const isBrowser = typeof window !== 'undefined';
// Next.js inlines NODE_ENV at build time for client bundles; safe in Edge Runtime too.
const isDevelopment = process.env.NODE_ENV === 'development';

export class Logger {
  private readonly scope: string;
  private readonly prefix: string;
  private readonly minLevel: LogLevel;

  /**
   * @param scope - Human-readable label, e.g. `'Slack'`. Rendered as `[Slack]`.
   * @param options - Optional level filter.
   */
  constructor(scope: string, options: LoggerOptions = {}) {
    this.scope = scope;
    this.prefix = `[${scope}]`;
    this.minLevel = options.minLevel ?? (isDevelopment ? DEV_MIN_LEVEL : DEFAULT_MIN_LEVEL);
  }

  /**
   * Log a verbose diagnostic message. Suppressed in production by default.
   *
   * @param message - Human-readable description of the event.
   * @param data - Optional additional context (object, string, Error, etc.).
   */
  debug(message: string, data?: unknown): void {
    this.emit('debug', message, data);
  }

  /**
   * Log a general informational message.
   *
   * @param message - Human-readable description of the event.
   * @param data - Optional additional context.
   */
  info(message: string, data?: unknown): void {
    this.emit('info', message, data);
  }

  /**
   * Log a recoverable problem or unexpected condition.
   *
   * @param message - Human-readable description of the problem.
   * @param data - Optional additional context.
   */
  warn(message: string, data?: unknown): void {
    this.emit('warn', message, data);
  }

  /**
   * Log an error.
   *
   * @param message - Human-readable description of the error.
   * @param data - Optional Error instance or additional context object.
   */
  error(message: string, data?: unknown): void {
    this.emit('error', message, data);
  }

  private emit(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[this.minLevel]) return;

    if (isBrowser) {
      this.emitBrowser(level, message, data);
    } else if (isDevelopment) {
      this.emitServerDev(level, message, data);
    } else {
      this.emitServerProd(level, message, data);
    }
  }

  /**
   * Browser: plain console calls — no ANSI codes, no JSON serialization.
   *
   * @param level - Log level to emit.
   * @param message - Message to log.
   * @param data - Optional additional context.
   */
  private emitBrowser(level: LogLevel, message: string, data?: unknown): void {
    const prefixed = `${this.prefix} ${message}`;

    if (data !== undefined) {
      console[level](prefixed, data);
    } else {
      console[level](prefixed);
    }
  }

  /**
   * Server development: human-readable colored output.
   * Format: `HH:MM:SS LEVEL [Scope] Message  {data}`
   *
   * @param level - Log level to emit.
   * @param message - Message to log.
   * @param data - Optional additional context.
   */
  private emitServerDev(level: LogLevel, message: string, data?: unknown): void {
    const time = new Date().toISOString().slice(11, 19);
    const color = LEVEL_COLOR[level];
    const levelTag = `${color}${level.toUpperCase().padEnd(5)}${ANSI.reset}`;
    const scopeTag = `${ANSI.dim}${this.prefix}${ANSI.reset}`;
    const line = `${ANSI.gray}${time}${ANSI.reset} ${levelTag} ${scopeTag} ${message}`;

    if (data !== undefined) {
      console[level](line, data);
    } else {
      console[level](line);
    }
  }

  /**
   * Server production: single-line JSON per entry.
   * Vercel captures stdout as structured logs; flat JSON fields are queryable by log drains.
   *
   * @param level - Log level to emit.
   * @param message - Message to log.
   * @param data - Optional additional context.
   */
  private emitServerProd(level: LogLevel, message: string, data?: unknown): void {
    const entry = this.buildEntry(level, message, data);

    console[level](JSON.stringify(entry));
  }

  /**
   * Build a structured LogEntry for prod JSON output.
   *
   * @param level - Log level.
   * @param message - Message string.
   * @param data - Optional Error instance or plain context object.
   * @returns A serializable LogEntry ready for JSON output.
   */
  private buildEntry(level: LogLevel, message: string, data?: unknown): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
    };

    if (data !== undefined) {
      if (data instanceof Error) {
        entry.error = {
          name: data.name,
          message: data.message,
          stack: data.stack,
        };
      } else {
        entry.data = data;
      }
    }

    return entry;
  }
}

/**
 * Create a scoped logger for a module, service, or route.
 *
 * @param scope - Label for the `[Scope]` prefix (e.g. `'Slack'`, `'Evaluate'`).
 * @param options - Optional level filter.
 * @returns A scoped Logger instance.
 *
 * @example
 * ```ts
 * const logger = createLogger('Evaluate');
 * logger.warn('Rule evaluation skipped — no active rules');
 * logger.error('Redis connection failed', error);
 * ```
 */
export function createLogger(scope: string, options?: LoggerOptions): Logger {
  return new Logger(scope, options);
}
