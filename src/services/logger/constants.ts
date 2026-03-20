import type { LogLevel } from './types';

/** Numeric weight for level filtering. Higher = more severe. */
export const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

/** ANSI escape codes for dev-mode colored terminal output. */
export const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

/** Maps each log level to an ANSI color for terminal output. */
export const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.gray,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
} as const;

/** Minimum level emitted in production (suppresses debug noise). */
export const DEFAULT_MIN_LEVEL: LogLevel = 'info';

/** Minimum level emitted in development (all levels). */
export const DEV_MIN_LEVEL: LogLevel = 'debug';
