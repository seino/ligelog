/**
 * @file index.ts
 * Sentry integration for ligelog via the `onAfterWrite` hook.
 *
 * Rather than implementing a `Transport`, Sentry forwarding is provided as a
 * hook so it operates on the original `LogRecord` — not the serialized string.
 * This gives richer context (Error instances, typed fields) to Sentry without
 * a second parse pass.
 *
 * ## Setup
 *
 * ```ts
 * import * as Sentry from '@sentry/node'
 * import { createLogger } from 'ligelog'
 * import { createSentryHook } from '@ligelog/sentry'
 *
 * Sentry.init({ dsn: process.env.SENTRY_DSN })
 *
 * const logger = createLogger({ level: 'info' })
 * logger.use(createSentryHook({ sentry: Sentry }))
 * ```
 *
 * ## Behavior by log level
 *
 * | Level | `captureErrors: true` (default) | `captureErrors: false` |
 * |-------|----------------------------------|------------------------|
 * | debug | breadcrumb only (if `breadcrumbs: true`) | breadcrumb only |
 * | info  | breadcrumb only                  | breadcrumb only |
 * | warn  | `captureMessage` + breadcrumb    | `captureMessage` + breadcrumb |
 * | error | `captureException` if Error present, else `captureMessage` | `captureMessage` |
 * | fatal | same as error                    | `captureMessage` |
 *
 * `@sentry/node` is a **peer dependency** — install it separately in your project.
 *
 * @packageDocumentation
 */

import type { Hooks, LogRecord } from 'ligelog';
import { LEVELS } from 'ligelog';

// ---------------------------------------------------------------------------
// Minimal Sentry interface
// ---------------------------------------------------------------------------

/**
 * Subset of the Sentry SDK surface that ligelog uses.
 * Compatible with `@sentry/node`, `@sentry/browser`, `@sentry/nextjs`, etc.
 * Assumes the overload where `captureMessage(message, level, hint)` is valid
 * (current modern SDK shape at time of writing).
 */
export interface SentryLike {
  captureException(err: unknown, hint?: { extra?: Record<string, unknown> }): void;
  captureMessage(msg: string, level?: string, hint?: { extra?: Record<string, unknown> }): void;
  addBreadcrumb(b: { message: string; level?: string; data?: Record<string, unknown> }): void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options accepted by `createSentryHook`. */
export interface SentryHookOptions {
  /**
   * An initialized Sentry SDK instance.
   * Pass the default import from `@sentry/node` (or any compatible SDK).
   */
  sentry: SentryLike;

  /**
   * When `true`, `error` and `fatal` entries that carry an `Error` object in
   * their extra fields are forwarded via `captureException` instead of
   * `captureMessage`. This preserves the full stack trace in Sentry.
   * @default true
   */
  captureErrors?: boolean;

  /**
   * When `true`, entries at or above `minLevel` are also added as Sentry
   * breadcrumbs for richer timeline context on subsequent exceptions.
   * @default true
   */
  breadcrumbs?: boolean;

  /**
   * Minimum log level to forward to Sentry.
   * Entries below this level are ignored by the hook entirely.
   * @default 'warn'
   */
  minLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map ligelog level names to Sentry severity strings. */
const SENTRY_LEVELS: Record<string, string> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'fatal',
};

const toSentryLevel = (lvl: string): string => SENTRY_LEVELS[lvl] ?? 'info';

/** Numeric level map used for threshold comparison. */
const NUMERIC = LEVELS;

/**
 * Strip the fixed LogRecord fields and return only the user-supplied context.
 * This becomes the `extra` object sent to Sentry.
 */
function extractExtra(record: LogRecord): Record<string, unknown> {
  const { level: _l, lvl: _lv, time: _t, msg: _m, pid: _p, ...rest } = record;
  return rest;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ligelog `Hooks` object that forwards log entries to Sentry.
 *
 * Attach it to any logger instance with `logger.use(createSentryHook(...))`.
 * The hook runs in the `onAfterWrite` phase so it never blocks serialization.
 *
 * @param opts - Configuration options.
 * @returns A `Hooks` object ready to be passed to `logger.use()`.
 *
 * @example
 * ```ts
 * logger.use(createSentryHook({
 *   sentry:        Sentry,
 *   minLevel:      'error',
 *   captureErrors: true,
 *   breadcrumbs:   false,
 * }))
 * ```
 */
export function createSentryHook(opts: SentryHookOptions): Hooks {
  const { sentry, captureErrors = true, breadcrumbs = true, minLevel = 'warn' } = opts;

  const threshold = NUMERIC[minLevel] ?? 30;

  return {
    onAfterWrite: [
      ({ record }) => {
        // Fast path — skip entries below the configured threshold.
        if (record.level < threshold) return;

        const extra = extractExtra(record);
        const sl = toSentryLevel(record.lvl);

        if (captureErrors && (record.lvl === 'error' || record.lvl === 'fatal')) {
          // Prefer captureException when an Error object is present in extra fields.
          const err = Object.values(extra).find((v) => v instanceof Error);
          if (err instanceof Error) {
            sentry.captureException(err, { extra: { ...extra, msg: record.msg } });
            // Still add a breadcrumb unless disabled.
            if (breadcrumbs) {
              sentry.addBreadcrumb({ message: record.msg, level: sl, data: extra });
            }
            return;
          }
        }

        // Fallback — forward as a message event.
        sentry.captureMessage(record.msg, sl, { extra });

        if (breadcrumbs) {
          sentry.addBreadcrumb({ message: record.msg, level: sl, data: extra });
        }
      },
    ],
  };
}
