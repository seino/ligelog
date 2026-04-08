/**
 * @file logger.ts
 * Core `Logger` class.
 *
 * A `Logger` instance is cheap to create and safe to share across modules.
 * Use `logger.child(ctx)` to derive a scoped logger that inherits the parent's
 * transports, hooks, and context while adding its own fields.
 *
 * @example
 * ```ts
 * import { createLogger, StdoutTransport } from 'ligelog'
 *
 * const logger = createLogger({ level: 'info' })
 *
 * const req = logger.child({ requestId: crypto.randomUUID() })
 * req.info('request received', { method: 'GET', path: '/api/users' })
 * req.error('unhandled error', { error: new Error('boom') })
 * ```
 */

import {
  LEVELS,
  type LevelName,
  type LevelValue,
  type LoggerOptions,
  type Hooks,
} from './types'
import { serialize }           from './serializer'
import { AsyncQueue }          from './queue'
import { runHooks, runAfterWriteHooks, mergeHooks } from './hooks'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Process ID — falls back to 0 in browser / edge runtimes. */
const PID: number = typeof process !== 'undefined' ? process.pid : 0

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Lightweight, hook-based structured logger.
 *
 * All log methods (`debug`, `info`, `warn`, `error`, `fatal`) follow the
 * same signature:
 *
 * ```ts
 * logger.info(message, extraFields?)
 * ```
 *
 * Extra fields are shallow-merged with the logger's static context and
 * serialized into the JSON output.
 */
export class Logger {
  private readonly minLevel: LevelValue
  private readonly context:  Record<string, unknown>
  private          hooks:    Hooks
  private readonly queue:    AsyncQueue

  constructor(opts: LoggerOptions = {}, queue?: AsyncQueue) {
    this.minLevel = LEVELS[opts.level ?? 'info']
    this.context  = opts.context ?? {}
    this.hooks    = opts.hooks   ?? {}
    this.queue    = queue ?? new AsyncQueue(opts.transports ?? [], opts.queueSize)
  }

  // -------------------------------------------------------------------------
  // Hook registration
  // -------------------------------------------------------------------------

  /**
   * Append one or more lifecycle hooks to this logger.
   * Hooks are executed in insertion order within each phase.
   * Returns `this` for a fluent API.
   *
   * @example
   * ```ts
   * logger.use(createSentryHook({ sentry: Sentry }))
   * ```
   */
  use(hooks: Hooks): this {
    this.hooks = mergeHooks(this.hooks, hooks)
    return this
  }

  // -------------------------------------------------------------------------
  // Log methods
  // -------------------------------------------------------------------------

  /** Emit a `debug` (level 10) log entry. */
  debug(msg: string, extra?: Record<string, unknown>): void {
    this.emit('debug', msg, extra)
  }

  /** Emit an `info` (level 20) log entry. */
  info(msg: string, extra?: Record<string, unknown>): void {
    this.emit('info', msg, extra)
  }

  /** Emit a `warn` (level 30) log entry. */
  warn(msg: string, extra?: Record<string, unknown>): void {
    this.emit('warn', msg, extra)
  }

  /** Emit an `error` (level 40) log entry. */
  error(msg: string, extra?: Record<string, unknown>): void {
    this.emit('error', msg, extra)
  }

  /** Emit a `fatal` (level 50) log entry. */
  fatal(msg: string, extra?: Record<string, unknown>): void {
    this.emit('fatal', msg, extra)
  }

  // -------------------------------------------------------------------------
  // Child logger
  // -------------------------------------------------------------------------

  /**
   * Create a child logger that inherits the parent's transports, hooks, and
   * context, then merges `ctx` on top.
   *
   * Child loggers share the parent's `AsyncQueue`, so all descendants write
   * through the same transport pipeline.
   *
   * @param ctx - Additional fields to merge into every record.
   */
  child(ctx: Record<string, unknown>): Logger {
    return new Logger({
      level:      this.currentLevelName(),
      context:    { ...this.context, ...ctx },
      transports: this.queue.transports,
      hooks:      this.hooks,
    }, this.queue)
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Wait for all queued log entries to be written by every transport.
   * Call this before process exit to avoid losing buffered entries.
   *
   * @example
   * ```ts
   * process.on('beforeExit', () => logger.flush())
   * ```
   */
  async flush(): Promise<void> {
    await this.queue.drain()
    await Promise.all(
      this.queue.transports.map(t => t.flush?.() ?? Promise.resolve()),
    )
  }

  /**
   * Gracefully stop logging and release transport resources.
   *
   * This waits for queued entries, flushes transports, then calls `close()`
   * on transports that implement it.
   */
  async close(): Promise<void> {
    await this.flush()
    await Promise.all(
      this.queue.transports.map(t => t.close?.() ?? Promise.resolve()),
    )
  }

  /**
   * Total entries dropped due to back-pressure since this logger was created.
   * A non-zero value means the async queue was full — add faster transports
   * or reduce log volume.
   */
  getDropped(): number {
    return this.queue.getDropped()
  }

  /**
   * Total transport write failures observed by the async queue.
   * Non-zero means one or more transports threw during write.
   */
  getWriteErrors(): number {
    return this.queue.getWriteErrors()
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Core emit path shared by all log-level methods.
   *
   * 1. Guard — drop if below `minLevel`.
   * 2. Build the `LogRecord` from context + extra fields.
   * 3. Run `onBeforeWrite` / `onSerialize`.
   * 4. Serialize (using `ctx.output` if a hook replaced it).
   * 5. Enqueue the line for async transport dispatch.
   * 6. Run `onAfterWrite` after enqueue.
   */
  private emit(
    lvl:    LevelName,
    msg:    string,
    extra?: Record<string, unknown>,
  ): void {
    const lv = LEVELS[lvl]
    if (lv < this.minLevel) return

    const record = {
      ...this.context,
      ...extra,
      level: lv   as LevelValue,
      lvl,
      time:  Date.now(),
      msg,
      pid:   PID,
    }

    // Run hooks; null means the entry was dropped by an onBeforeWrite hook.
    // Hooks may replace `ctx.record` with a new object (immutable update),
    // so downstream serialization and transport dispatch must read from
    // `ctx.record` rather than the original local `record`.
    const ctx = runHooks(this.hooks, { record }, { skipAfterWrite: true })
    if (!ctx) return

    // Use the hook-provided output string, or fall back to the built-in serializer.
    const line = ctx.output ?? serialize(ctx.record)

    this.queue.enqueue(line, ctx.record)
    runAfterWriteHooks(this.hooks, ctx)
  }

  /** Reverse-map the numeric minLevel back to its string name. */
  private currentLevelName(): LevelName {
    return (Object.keys(LEVELS) as LevelName[]).find(
      k => LEVELS[k] === this.minLevel,
    )!
  }
}
