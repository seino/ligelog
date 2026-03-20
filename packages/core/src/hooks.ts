/**
 * @file hooks.ts
 * Hook pipeline execution and composition utilities.
 *
 * The pipeline runs in three ordered phases for every log record:
 *
 *   1. `onBeforeWrite`  — filter / mutate the record before serialization.
 *                         Return `false` to drop the entry silently.
 *   2. `onSerialize`    — override or transform the serialized output string.
 *   3. `onAfterWrite`   — side-effects after the line has been queued
 *                         (e.g. forwarding to Sentry, Datadog, OpenTelemetry).
 *
 * Each phase is an ordered array of functions; they execute in insertion order.
 * Hooks added via `logger.use()` are appended after those passed at construction.
 */

import type { Hooks, HookContext } from './types'

/**
 * Execute the full hook pipeline for a single log record.
 *
 * @param hooks - The hooks registered on the logger instance.
 * @param ctx   - The initial context wrapping the resolved `LogRecord`.
 * @returns The (possibly mutated) context, or `null` if the entry was dropped.
 */
export function runHooks(
  hooks: Hooks,
  ctx: HookContext,
  options: { skipAfterWrite?: boolean } = {},
): HookContext | null {
  // Phase 1 — onBeforeWrite: may mutate or drop the record.
  for (const fn of hooks.onBeforeWrite ?? []) {
    let result: HookContext | false
    try {
      result = fn(ctx)
    } catch {
      // Hook failures must not crash app code; drop this entry.
      return null
    }
    if (result === false) return null  // entry dropped
    ctx = result
  }

  // Phase 2 — onSerialize: may replace ctx.output with a custom format.
  for (const fn of hooks.onSerialize ?? []) {
    try {
      ctx = fn(ctx)
    } catch {
      // Keep prior ctx and continue to default serializer path.
    }
  }

  // Phase 3 — onAfterWrite: side-effects only, return value is ignored.
  if (!options.skipAfterWrite) {
    for (const fn of hooks.onAfterWrite ?? []) {
      fn(ctx)
    }
  }

  return ctx
}

/**
 * Execute only `onAfterWrite` hooks for a previously processed context.
 * This is used by Logger after the entry has been enqueued.
 */
export function runAfterWriteHooks(hooks: Hooks, ctx: HookContext): void {
  for (const fn of hooks.onAfterWrite ?? []) {
    try {
      fn(ctx)
    } catch {
      // Side-effect hook failures are isolated by design.
    }
  }
}

/**
 * Merge two `Hooks` objects into a single one.
 * Arrays are concatenated so that `extra` hooks always run after `base` hooks.
 *
 * Used internally by `logger.use()` to append hooks after construction.
 *
 * @param base  - Hooks already registered on the logger.
 * @param extra - New hooks to append.
 * @returns A new `Hooks` object — does not mutate either input.
 */
export function mergeHooks(base: Hooks, extra: Hooks): Hooks {
  return {
    onBeforeWrite: [...(base.onBeforeWrite ?? []), ...(extra.onBeforeWrite ?? [])],
    onSerialize:   [...(base.onSerialize   ?? []), ...(extra.onSerialize   ?? [])],
    onAfterWrite:  [...(base.onAfterWrite  ?? []), ...(extra.onAfterWrite  ?? [])],
  }
}
