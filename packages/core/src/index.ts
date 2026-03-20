/**
 * @file index.ts
 * Public API surface for ligelog.
 *
 * Import everything from `'ligelog'`:
 *
 * ```ts
 * import { createLogger, FileTransport } from 'ligelog'
 * ```
 *
 * @module ligelog
 */

// Core classes
export { Logger } from './logger';

// Transports
export { StdoutTransport } from './transports/stdout';
export { FileTransport } from './transports/file';

// Types — exported for consumers who extend ligelog
export type {
  LevelName,
  LevelValue,
  LogRecord,
  Transport,
  Hooks,
  HookContext,
  BeforeWriteHook,
  SerializeHook,
  AfterWriteHook,
  LoggerOptions,
} from './types';

export type { FileTransportOptions } from './transports/file';

// Re-export the LEVELS map so consumers can do numeric comparisons
export { LEVELS } from './types';

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

import { Logger } from './logger';
import { StdoutTransport } from './transports/stdout';
import type { LoggerOptions } from './types';

/**
 * Create a new `Logger` with sensible defaults.
 *
 * - When `transports` is omitted, a single `StdoutTransport` is used.
 * - When `level` is omitted, `'info'` is used.
 *
 * @example
 * ```ts
 * // Minimal — logs info+ to stdout
 * const logger = createLogger()
 *
 * // With options
 * const logger = createLogger({
 *   level:   'debug',
 *   context: { app: 'api', env: process.env.NODE_ENV },
 *   transports: [
 *     new StdoutTransport(),
 *     new FileTransport({ path: './logs/app.log' }),
 *   ],
 * })
 *
 * // Graceful shutdown
 * process.on('beforeExit', () => logger.flush())
 * ```
 *
 * @param opts - Optional logger configuration.
 * @returns A configured `Logger` instance.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const transports = opts.transports ?? [new StdoutTransport()];
  return new Logger({ ...opts, transports });
}
