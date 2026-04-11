/**
 * @file index.ts
 * Colorized, human-readable transport for development use.
 *
 * Inspired by Loguru's default console output format.
 * Uses raw ANSI escape codes — zero external dependencies.
 *
 * ## Output format
 *
 * ```
 * 2024-01-15 09:13:20.123 | INFO  | server started  port=3000
 * 2024-01-15 09:13:20.456 | ERROR | app.ts:42:handleRequest - db failed  error=ECONNREFUSED
 * ```
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog'
 * import { PrettyTransport } from '@ligelog/pretty'
 *
 * const logger = createLogger({
 *   transports: [new PrettyTransport()],
 * })
 * ```
 *
 * @packageDocumentation
 */

import type { Transport, LogRecord, LevelName } from 'ligelog';

// ---------------------------------------------------------------------------
// ANSI helpers (no external dependency)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const COLORS: Record<string, string> = {
  gray: '\x1b[90m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
};

function color(text: string, ...codes: string[]): string {
  return codes.join('') + text + RESET;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options accepted by `PrettyTransport`. */
export interface PrettyTransportOptions {
  /**
   * Whether to colorize the output with ANSI escape codes.
   * Defaults to `true` when stdout is a TTY and `NO_COLOR` is not set.
   */
  colorize?: boolean;

  /**
   * Timestamp format in the output line.
   * - `'iso'` — ISO 8601 string
   * - `'local'` — `YYYY-MM-DD HH:mm:ss.SSS` in local time
   * - `'elapsed'` — seconds elapsed since transport creation
   * @default 'local'
   */
  timestamp?: 'iso' | 'local' | 'elapsed';

  /**
   * How to display extra fields beyond the standard LogRecord keys.
   * - `'inline'` — `key=value` pairs appended to the line
   * - `'json'` — JSON stringified block
   * - `'hide'` — omit extra fields
   * @default 'inline'
   */
  extraStyle?: 'inline' | 'json' | 'hide';

  /**
   * Override default level colors.
   * Each value is a function `(text: string) => string`.
   */
  levelColors?: Partial<Record<LevelName, (text: string) => string>>;

  /**
   * Writable stream to output to.
   * @default process.stdout
   */
  output?: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Standard LogRecord keys to exclude from "extra" fields. */
const STANDARD_KEYS = new Set(['level', 'lvl', 'time', 'msg', 'pid', 'caller_file', 'caller_line', 'caller_fn']);

/** Default color functions per log level. */
const DEFAULT_LEVEL_COLORS: Record<LevelName, (text: string) => string> = {
  debug: (t) => color(t, COLORS.gray!),
  info: (t) => color(t, COLORS.blue!, BOLD),
  warn: (t) => color(t, COLORS.yellow!, BOLD),
  error: (t) => color(t, COLORS.red!, BOLD),
  fatal: (t) => color(t, COLORS.white!, BOLD, COLORS.bgRed!),
};

/** Identity function for no-color mode. */
const NO_COLOR_FN = (t: string) => t;

/** Pad level name to 5 characters. */
function padLevel(lvl: string): string {
  return lvl.toUpperCase().padEnd(5);
}

/** Format a Date as `YYYY-MM-DD HH:mm:ss.SSS` in local time. */
function formatLocal(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

/** Format a value for inline display. */
function formatValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    // JSON.stringify can throw on circular references — fall back to String().
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// PrettyTransport
// ---------------------------------------------------------------------------

/**
 * Human-readable colorized transport for development environments.
 *
 * Reads directly from the `LogRecord` — the `line` argument (NDJSON) is
 * ignored in favor of a formatted, human-friendly output.
 *
 * @example
 * ```ts
 * import { createLogger } from 'ligelog'
 * import { PrettyTransport } from '@ligelog/pretty'
 *
 * const logger = createLogger({
 *   transports: [new PrettyTransport({ timestamp: 'elapsed' })],
 * })
 * ```
 */
export class PrettyTransport implements Transport {
  private readonly colorize: boolean;
  private readonly timestampStyle: 'iso' | 'local' | 'elapsed';
  private readonly extraStyle: 'inline' | 'json' | 'hide';
  private readonly levelColorFns: Record<LevelName, (text: string) => string>;
  private readonly output: NodeJS.WritableStream;
  private readonly startTime: number;

  constructor(opts: PrettyTransportOptions = {}) {
    const hasNoColor = typeof process !== 'undefined' && !!process.env.NO_COLOR;
    const isTTY =
      typeof process !== 'undefined' && 'stdout' in process && 'isTTY' in process.stdout && !!process.stdout.isTTY;

    this.colorize = opts.colorize ?? (isTTY && !hasNoColor);
    this.timestampStyle = opts.timestamp ?? 'local';
    this.extraStyle = opts.extraStyle ?? 'inline';
    this.output = opts.output ?? process.stdout;
    this.startTime = Date.now();

    if (this.colorize) {
      this.levelColorFns = { ...DEFAULT_LEVEL_COLORS, ...opts.levelColors };
    } else {
      this.levelColorFns = {
        debug: NO_COLOR_FN,
        info: NO_COLOR_FN,
        warn: NO_COLOR_FN,
        error: NO_COLOR_FN,
        fatal: NO_COLOR_FN,
      };
    }
  }

  /**
   * Format and write a LogRecord as a human-readable line.
   * The `line` argument (serialized JSON) is ignored.
   */
  write(_line: string, record: LogRecord): void {
    const parts: string[] = [];

    // Timestamp
    const ts = this.formatTimestamp(record.time);
    parts.push(this.colorize ? color(ts, DIM) : ts);
    parts.push('|');

    // Level
    const lvl = padLevel(record.lvl);
    const colorFn = this.levelColorFns[record.lvl] ?? NO_COLOR_FN;
    parts.push(colorFn(lvl));
    parts.push('|');

    // Caller info (if present from @ligelog/caller)
    if (record.caller_file) {
      const callerStr =
        record.caller_fn && record.caller_fn !== '<anonymous>'
          ? `${record.caller_file}:${record.caller_line}:${record.caller_fn}`
          : `${record.caller_file}:${record.caller_line}`;
      parts.push(this.colorize ? color(callerStr, COLORS.cyan!) : callerStr);
      parts.push('-');
    }

    // Message
    parts.push(record.msg);

    // Extra fields
    const extraStr = this.formatExtra(record);
    if (extraStr) {
      parts.push(this.colorize ? color(extraStr, DIM) : extraStr);
    }

    this.output.write(parts.join(' ') + '\n');
  }

  private formatTimestamp(time: number): string {
    if (this.timestampStyle === 'iso') {
      return new Date(time).toISOString();
    }
    if (this.timestampStyle === 'elapsed') {
      const elapsed = ((time - this.startTime) / 1000).toFixed(3);
      return `+${elapsed}s`;
    }
    return formatLocal(new Date(time));
  }

  private formatExtra(record: LogRecord): string {
    if (this.extraStyle === 'hide') return '';

    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!STANDARD_KEYS.has(key)) {
        extras[key] = value;
      }
    }

    const keys = Object.keys(extras);
    if (keys.length === 0) return '';

    if (this.extraStyle === 'json') {
      return JSON.stringify(extras);
    }

    // inline: key=value pairs
    return keys.map((k) => `${k}=${formatValue(extras[k])}`).join(' ');
  }
}
