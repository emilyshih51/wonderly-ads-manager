export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A structured log entry emitted in production (server-side).
 * Shape is flat so Vercel log drain parsers can index every field.
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  level: LogLevel;
  /** The bracket prefix label, e.g. "Slack" — stored without brackets */
  scope: string;
  message: string;
  /** Additional data passed to the log call (non-Error values) */
  data?: unknown;
  /** Serialized error fields, present only when data is an Error instance */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Optional hook for forwarding error-level entries to an external service
 * (e.g. Sentry, Datadog). Called after the console write.
 */
export type ErrorReporter = (entry: LogEntry) => void;

export interface LoggerOptions {
  /**
   * Minimum level to emit. Calls below this level are silenced.
   * Defaults to 'debug' in development, 'info' in production.
   */
  minLevel?: LogLevel;
  /**
   * Called for every error-level entry, after the console write.
   * Wire this up to an external error service when ready.
   */
  onError?: ErrorReporter;
}

export interface ILogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
