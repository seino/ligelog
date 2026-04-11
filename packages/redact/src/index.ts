/**
 * @file index.ts
 * PII field masking hook for ligelog.
 *
 * Redacts sensitive fields from LogRecord before serialization using
 * dot-path patterns with wildcard support.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog';
 * import { createRedactHook } from '@ligelog/redact';
 *
 * const logger = createLogger();
 * logger.use(createRedactHook({ paths: ['password', 'user.*.ssn'] }));
 * ```
 *
 * @packageDocumentation
 */

import type { Hooks, HookContext } from 'ligelog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Allowed return types for a censor function. */
export type CensorValue = string | number | boolean | null | undefined;

/** Options accepted by `createRedactHook`. */
export interface RedactOptions {
  /**
   * Dot-separated field paths to redact.
   * Supports `*` as a wildcard to match any key at that level.
   *
   * @example ['password', 'headers.authorization', 'user.*.ssn']
   */
  readonly paths: readonly string[];

  /**
   * Replacement value or function for redacted fields.
   * A function receives the original value and the full dot-path.
   * If the function throws, `'[CENSOR_ERROR]'` is used as a fallback.
   * @default '[REDACTED]'
   */
  censor?: string | ((value: unknown, path: string) => CensorValue);

  /**
   * When `true`, redacted keys are removed entirely instead of replaced.
   * @default false
   */
  remove?: boolean;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A single segment in a compiled redaction path. */
type PathSegment = string | '*';

// ---------------------------------------------------------------------------
// Path compiler
// ---------------------------------------------------------------------------

/** Pre-compile dot-path strings into segment arrays for fast matching. */
function compilePaths(paths: readonly string[]): PathSegment[][] {
  return paths.map((p) => p.split('.'));
}

// ---------------------------------------------------------------------------
// Copy-on-Write redaction engine
// ---------------------------------------------------------------------------

/**
 * Apply redaction to an object using Copy-on-Write semantics.
 * Only objects along the redaction path are shallow-cloned; unrelated
 * branches keep their original references.
 */
function applyRedaction(
  obj: Record<string, unknown>,
  compiledPaths: PathSegment[][],
  censorFn: (value: unknown, path: string) => unknown,
  remove: boolean
): Record<string, unknown> {
  let result = obj;

  for (const segments of compiledPaths) {
    // Each path gets its own visited set for circular reference detection
    result = redactPath(result, segments, 0, censorFn, remove, '', new Set());
  }

  return result;
}

/**
 * Recursively walk the path segments and apply redaction.
 * Returns the same object reference if no changes were made.
 *
 * Uses a `seen` set as an ancestor stack to guard against circular
 * references while still allowing shared (non-circular) object
 * references to be redacted at every location.
 */
function redactPath(
  obj: Record<string, unknown>,
  segments: PathSegment[],
  index: number,
  censorFn: (value: unknown, path: string) => unknown,
  remove: boolean,
  currentPath: string,
  seen: Set<object>
): Record<string, unknown> {
  if (index >= segments.length) return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);

  const segment = segments[index]!;
  const isLast = index === segments.length - 1;
  const keys = segment === '*' ? Object.keys(obj) : [segment];

  let result = obj;
  let cloned = false;

  for (const key of keys) {
    if (!Object.hasOwn(obj, key)) continue;

    const fullPath = currentPath ? `${currentPath}.${key}` : key;

    if (isLast) {
      // Terminal segment — apply redaction
      if (!cloned) {
        result = { ...obj };
        cloned = true;
      }
      if (remove) {
        delete result[key];
      } else {
        result[key] = censorFn(obj[key], fullPath);
      }
    } else {
      // Intermediate segment — recurse into nested object
      const child = obj[key];
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        const updated = redactPath(
          child as Record<string, unknown>,
          segments,
          index + 1,
          censorFn,
          remove,
          fullPath,
          seen
        );
        if (updated !== child) {
          if (!cloned) {
            result = { ...obj };
            cloned = true;
          }
          result[key] = updated;
        }
      }
    }
  }

  // Remove from ancestor stack so shared (non-circular) references
  // can be redacted when encountered via a different key.
  seen.delete(obj);

  return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const CENSOR_ERROR_FALLBACK = '[CENSOR_ERROR]';
const DEFAULT_CENSOR = '[REDACTED]';

/**
 * Create a ligelog hook that redacts sensitive fields from log records.
 *
 * Runs as an `onBeforeWrite` hook using Copy-on-Write semantics:
 * the original `ctx.record` is never mutated.
 *
 * @param opts - Redaction configuration.
 * @returns A `Hooks` object ready for `logger.use()`.
 *
 * @example
 * ```ts
 * // Basic usage
 * logger.use(createRedactHook({ paths: ['password', 'token'] }));
 *
 * // Custom censor function
 * logger.use(createRedactHook({
 *   paths: ['email'],
 *   censor: (value) => typeof value === 'string'
 *     ? value.replace(/(.{2}).+(@.+)/, '$1***$2')
 *     : '[REDACTED]',
 * }));
 *
 * // Remove keys entirely
 * logger.use(createRedactHook({ paths: ['secret'], remove: true }));
 * ```
 */
export function createRedactHook(opts: RedactOptions): Hooks {
  const { paths, censor = DEFAULT_CENSOR, remove = false } = opts;

  if (paths.length === 0) {
    return {};
  }

  const compiledPaths = compilePaths(paths);

  const censorFn: (value: unknown, path: string) => unknown =
    typeof censor === 'function'
      ? (value: unknown, path: string) => {
          try {
            return censor(value, path);
          } catch {
            return CENSOR_ERROR_FALLBACK;
          }
        }
      : () => censor;

  return {
    onBeforeWrite: [
      (ctx: HookContext): HookContext => {
        const redacted = applyRedaction(
          ctx.record as unknown as Record<string, unknown>,
          compiledPaths,
          censorFn,
          remove
        );

        if (redacted === (ctx.record as unknown)) {
          return ctx;
        }

        return { ...ctx, record: redacted as HookContext['record'] };
      },
    ],
  };
}
