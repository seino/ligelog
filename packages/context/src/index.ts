/**
 * @file index.ts
 * AsyncLocalStorage-based context propagation for ligelog.
 *
 * Automatically injects contextual fields (requestId, userId, traceId, etc.)
 * into every log record within an async scope, inspired by Java SLF4J MDC
 * and .NET ILogger.BeginScope.
 *
 * **Node.js only** — uses `AsyncLocalStorage` (stable since Node.js 16.4).
 * For Edge Runtime / Cloudflare Workers, use framework-native context
 * (e.g. Hono `c.set()`).
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog';
 * import { createContextStore, createContextHook } from '@ligelog/context';
 *
 * const store = createContextStore();
 * const logger = createLogger();
 * logger.use(createContextHook(store));
 *
 * store.run({ requestId: 'abc-123' }, () => {
 *   logger.info('handled'); // → { requestId: 'abc-123', ... }
 * });
 * ```
 *
 * @packageDocumentation
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Hooks, HookContext } from 'ligelog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** AsyncLocalStorage-based context store. */
export interface ContextStore {
  /**
   * Run a callback within a new context scope.
   * The given fields are merged with any parent context.
   * Nesting is supported — inner `run()` calls override outer fields.
   */
  run<T>(fields: Record<string, unknown>, fn: () => T): T;

  /**
   * Get the current context fields.
   * Returns an empty object when called outside any `run()` scope.
   */
  get(): Readonly<Record<string, unknown>>;

  /**
   * Add fields to the current context.
   * Only effective within a `run()` scope. No-op outside.
   */
  set(fields: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

/**
 * Create a new context store backed by `AsyncLocalStorage`.
 *
 * Each store is independent — multiple stores can coexist without
 * interference (e.g. one for request context, one for job context).
 */
export function createContextStore(): ContextStore {
  const als = new AsyncLocalStorage<Record<string, unknown>>();

  return {
    run<T>(fields: Record<string, unknown>, fn: () => T): T {
      const parent = als.getStore() ?? {};
      return als.run({ ...parent, ...fields }, fn);
    },

    get(): Readonly<Record<string, unknown>> {
      return als.getStore() ?? {};
    },

    set(fields: Record<string, unknown>): void {
      const current = als.getStore();
      if (current) {
        Object.assign(current, fields);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Hook factory
// ---------------------------------------------------------------------------

/** LogRecord keys that must never be overridden by context fields. */
const RESERVED_KEYS = new Set(['level', 'lvl', 'time', 'msg', 'pid']);

/**
 * Create a ligelog hook that injects context store fields into log records.
 *
 * Runs as an `onBeforeWrite` hook. Context fields are merged into the
 * record using Copy-on-Write semantics. Explicitly passed fields take
 * precedence over context fields.
 *
 * Reserved LogRecord keys (`level`, `lvl`, `time`, `msg`, `pid`) in the
 * context store are silently ignored to prevent accidental corruption.
 *
 * @param store - A context store created by `createContextStore()`.
 * @returns A `Hooks` object ready for `logger.use()`.
 *
 * @example
 * ```ts
 * const store = createContextStore();
 * logger.use(createContextHook(store));
 *
 * store.run({ requestId: 'abc', userId: 42 }, () => {
 *   logger.info('handled'); // record includes requestId and userId
 * });
 * ```
 */
export function createContextHook(store: ContextStore): Hooks {
  return {
    onBeforeWrite: [
      (ctx: HookContext): HookContext => {
        const contextFields = store.get();

        // No context available — pass through unchanged
        if (Object.keys(contextFields).length === 0) {
          return ctx;
        }

        // Filter out reserved LogRecord keys from context
        const safeFields: Record<string, unknown> = {};
        let hasFields = false;
        for (const key of Object.keys(contextFields)) {
          if (!RESERVED_KEYS.has(key)) {
            safeFields[key] = contextFields[key];
            hasFields = true;
          }
        }

        if (!hasFields) {
          return ctx;
        }

        // Merge: safe context fields first, then record fields (record wins)
        const merged = {
          ...safeFields,
          ...ctx.record,
        };

        return { ...ctx, record: merged as HookContext['record'] };
      },
    ],
  };
}
