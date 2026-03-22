/**
 * @file index.ts
 * Higher-order functions that wrap sync/async functions with automatic
 * error logging via a ligelog Logger instance.
 *
 * Inspired by Loguru's `@logger.catch` decorator.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog'
 * import { catchWith, catchAsync } from '@ligelog/catch'
 *
 * const logger = createLogger()
 *
 * const safeParseJson = catchWith(logger, JSON.parse, { rethrow: false })
 * safeParseJson('invalid') // => logs error, returns undefined
 *
 * const safeFetch = catchAsync(logger, fetchData, { rethrow: false })
 * await safeFetch('/api') // => logs error on reject, returns undefined
 * ```
 *
 * @packageDocumentation
 */

import type { LevelName } from 'ligelog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal Logger interface — only the log-level methods we call. */
interface LoggerLike {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  fatal(msg: string, extra?: Record<string, unknown>): void;
}

/** Options accepted by `catchWith` and `catchAsync`. */
export interface CatchOptions {
  /**
   * Log level used when an error is caught.
   * @default 'error'
   */
  level?: LevelName;

  /**
   * Whether to re-throw the caught error after logging.
   * When `false`, the wrapped function returns `undefined` on error.
   * @default true
   */
  rethrow?: boolean;

  /**
   * Custom message for the log entry.
   * @default 'Caught exception in <fnName>'
   */
  message?: string;

  /**
   * Extract additional context to include in the log entry.
   * Receives the caught error and the original arguments.
   */
  extra?: (error: unknown, args: unknown[]) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// `any` is intentional here — these aliases must accept arbitrary function
// signatures so that `catchWith` / `catchAsync` can wrap any user function
// without forcing callers to satisfy a narrower constraint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFn = (...args: any[]) => Promise<any>;

/** Get a human-readable function name. */
function getFnName(fn: AnyFn): string {
  return fn.name || '<anonymous>';
}

/** Build the log extra object from a caught error. */
function buildExtra(
  error: unknown,
  args: unknown[],
  fnName: string,
  extraFn?: (error: unknown, args: unknown[]) => Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { error, fn: fnName };
  if (extraFn) {
    return { ...base, ...extraFn(error, args) };
  }
  return base;
}

// ---------------------------------------------------------------------------
// catchWith — synchronous
// ---------------------------------------------------------------------------

/**
 * Wrap a synchronous function with automatic error logging.
 *
 * @param logger - Logger instance to log caught errors.
 * @param fn - The function to wrap.
 * @param opts - Configuration options.
 * @returns A wrapped function with the same signature.
 *
 * @example
 * ```ts
 * const safeParse = catchWith(logger, JSON.parse, {
 *   rethrow: false,
 *   message: 'JSON parse failed',
 * })
 * const data = safeParse(input) // => undefined on error
 * ```
 */
export function catchWith<F extends AnyFn>(
  logger: LoggerLike,
  fn: F,
  opts?: CatchOptions & { rethrow?: true },
): (...args: Parameters<F>) => ReturnType<F>;

export function catchWith<F extends AnyFn>(
  logger: LoggerLike,
  fn: F,
  opts: CatchOptions & { rethrow: false },
): (...args: Parameters<F>) => ReturnType<F> | undefined;

export function catchWith<F extends AnyFn>(
  logger: LoggerLike,
  fn: F,
  opts: CatchOptions = {},
): (...args: Parameters<F>) => ReturnType<F> | undefined {
  const {
    level = 'error',
    rethrow = true,
    message,
    extra: extraFn,
  } = opts;

  const fnName = getFnName(fn);
  const msg = message ?? `Caught exception in ${fnName}`;

  return function (this: unknown, ...args: Parameters<F>): ReturnType<F> | undefined {
    try {
      return fn.apply(this, args);
    } catch (error: unknown) {
      logger[level](msg, buildExtra(error, args, fnName, extraFn));
      if (rethrow) throw error;
      return undefined;
    }
  };
}

// ---------------------------------------------------------------------------
// catchAsync — asynchronous
// ---------------------------------------------------------------------------

/**
 * Wrap an async function with automatic error logging.
 *
 * @param logger - Logger instance to log caught errors.
 * @param fn - The async function to wrap.
 * @param opts - Configuration options.
 * @returns A wrapped async function with the same signature.
 *
 * @example
 * ```ts
 * const safeFetch = catchAsync(logger, fetchData, { rethrow: false })
 * const result = await safeFetch('/api') // => undefined on rejection
 * ```
 */
export function catchAsync<F extends AsyncFn>(
  logger: LoggerLike,
  fn: F,
  opts?: CatchOptions & { rethrow?: true },
): (...args: Parameters<F>) => ReturnType<F>;

export function catchAsync<F extends AsyncFn>(
  logger: LoggerLike,
  fn: F,
  opts: CatchOptions & { rethrow: false },
): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>> | undefined>;

export function catchAsync<F extends AsyncFn>(
  logger: LoggerLike,
  fn: F,
  opts: CatchOptions = {},
): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>> | undefined> {
  const {
    level = 'error',
    rethrow = true,
    message,
    extra: extraFn,
  } = opts;

  const fnName = getFnName(fn);
  const msg = message ?? `Caught exception in ${fnName}`;

  return async function (this: unknown, ...args: Parameters<F>): Promise<Awaited<ReturnType<F>> | undefined> {
    try {
      return await fn.apply(this, args);
    } catch (error: unknown) {
      logger[level](msg, buildExtra(error, args, fnName, extraFn));
      if (rethrow) throw error;
      return undefined;
    }
  };
}
