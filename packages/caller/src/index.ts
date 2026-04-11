/**
 * @file index.ts
 * Hook that automatically adds caller file, line number, and function name
 * to every LogRecord. Inspired by Loguru's `<file>:<line>:<function>` display.
 *
 * Uses `Error.captureStackTrace` for lightweight stack capture.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog'
 * import { createCallerHook } from '@ligelog/caller'
 *
 * const logger = createLogger({ level: 'debug' })
 * logger.use(createCallerHook())
 * // => LogRecord gains caller_file, caller_line, caller_fn fields
 * ```
 *
 * @packageDocumentation
 */

import type { Hooks, LevelName } from 'ligelog';
import { LEVELS } from 'ligelog';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options accepted by `createCallerHook`. */
export interface CallerHookOptions {
  /**
   * Minimum log level to attach caller info.
   * Stack trace capture has a cost — use `'error'` in production.
   * @default 'debug'
   */
  minLevel?: LevelName;

  /**
   * Extra stack frame offset for custom wrapper functions.
   * @default 0
   */
  stackOffset?: number;

  /**
   * How to format the file path.
   * - `'basename'` — file name only (e.g. `server.ts`)
   * - `'full'` — absolute path
   * - `'relative'` — relative to `process.cwd()`
   * @default 'basename'
   */
  pathStyle?: 'full' | 'basename' | 'relative';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Patterns to identify ligelog-internal stack frames.
 * Uses both `/` and `\` separators for cross-platform support (Windows).
 */
const INTERNAL_PATTERNS = [
  // Published paths (node_modules)
  /ligelog[/\\]dist[/\\]/,
  /ligelog[/\\]src[/\\]/,
  /@ligelog[/\\]caller[/\\](?:dist|src)[/\\]/,
  /node_modules[/\\]ligelog[/\\]/,
  // Workspace dev paths
  /[/\\]packages[/\\]caller[/\\](?:src|dist)[/\\]/,
  /[/\\]packages[/\\]core[/\\](?:src|dist)[/\\]/,
];

/** Parse the first external caller frame from a captured stack trace. */
function parseCallerFrame(stackOffset: number): { file: string; line: number; fn: string } | null {
  const holder: { stack?: string } = {};
  const originalLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 15;
  Error.captureStackTrace(holder);
  Error.stackTraceLimit = originalLimit;

  if (!holder.stack) return null;

  const lines = holder.stack.split('\n');

  // Skip internal frames and find the first external caller
  let targetIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const isInternal = INTERNAL_PATTERNS.some((p) => p.test(line));
    if (!isInternal) {
      targetIndex = i + stackOffset;
      break;
    }
  }

  if (targetIndex < 0 || targetIndex >= lines.length) return null;

  return parseFrameLine(lines[targetIndex]!);
}

/** Parse a single V8 stack frame line into file, line, and function name. */
function parseFrameLine(frame: string): { file: string; line: number; fn: string } | null {
  // Normalize ESM `file:///` protocol
  const normalized = frame.replace(/file:\/\/\//g, '/');

  // Pattern: "at functionName (path:line:col)"
  const withFn = normalized.match(/at\s+(.+?)\s+\((.+):(\d+):\d+\)/);
  if (withFn) {
    return {
      fn: withFn[1]!,
      file: withFn[2]!,
      line: parseInt(withFn[3]!, 10),
    };
  }

  // Pattern: "at path:line:col" (anonymous)
  const withoutFn = normalized.match(/at\s+(.+):(\d+):\d+/);
  if (withoutFn) {
    return {
      fn: '<anonymous>',
      file: withoutFn[1]!,
      line: parseInt(withoutFn[2]!, 10),
    };
  }

  return null;
}

/** Format file path according to the specified style. */
function formatPath(filePath: string, style: 'full' | 'basename' | 'relative'): string {
  if (style === 'full') return filePath;

  if (style === 'basename') {
    const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;
  }

  // relative
  const cwd = process.cwd();
  if (filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length + 1);
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ligelog hook that attaches caller information to every LogRecord.
 *
 * Runs as an `onBeforeWrite` hook and adds:
 * - `caller_file` — source file name (formatted per `pathStyle`)
 * - `caller_line` — line number
 * - `caller_fn` — function name
 *
 * @param opts - Configuration options.
 * @returns A `Hooks` object ready for `logger.use()`.
 *
 * @example
 * ```ts
 * // Development: attach to all levels
 * logger.use(createCallerHook())
 *
 * // Production: error and above only
 * logger.use(createCallerHook({ minLevel: 'error' }))
 * ```
 */
export function createCallerHook(opts: CallerHookOptions = {}): Hooks {
  const { minLevel = 'debug', stackOffset = 0, pathStyle = 'basename' } = opts;

  const threshold = LEVELS[minLevel] ?? LEVELS.debug;

  return {
    onBeforeWrite: [
      (ctx) => {
        if (ctx.record.level < threshold) return ctx;

        const caller = parseCallerFrame(stackOffset);
        if (!caller) return ctx;

        ctx.record.caller_file = formatPath(caller.file, pathStyle);
        ctx.record.caller_line = caller.line;
        ctx.record.caller_fn = caller.fn;

        return ctx;
      },
    ],
  };
}
