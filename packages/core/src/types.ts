/**
 * @file types.ts
 * Core type definitions for ligelog.
 * All public-facing interfaces and enums are exported from here.
 */

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

/** Numeric severity values. Higher = more severe. */
export const LEVELS = {
  debug: 10,
  info:  20,
  warn:  30,
  error: 40,
  fatal: 50,
} as const

export type LevelName  = keyof typeof LEVELS
export type LevelValue = (typeof LEVELS)[LevelName]

// ---------------------------------------------------------------------------
// Log record
// ---------------------------------------------------------------------------

/**
 * A single, fully-resolved log entry before serialization.
 * All fields are plain JSON-serializable values.
 */
export interface LogRecord {
  /** Numeric severity (matches LEVELS). */
  level: LevelValue
  /** Human-readable severity string. */
  lvl:   LevelName
  /** Unix epoch milliseconds (Date.now()). */
  time:  number
  /** Human-readable message. */
  msg:   string
  /** Process ID — 0 in browser environments. */
  pid:   number
  /** Arbitrary structured context fields. */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Hook system
// ---------------------------------------------------------------------------

/**
 * Shared context object that flows through the hook pipeline.
 * Mutate `output` in `onSerialize` hooks to override the default serializer.
 */
export interface HookContext {
  /** The resolved log record. */
  record: LogRecord
  /**
   * Serialized output string.
   * If left undefined after all `onSerialize` hooks, the built-in
   * serializer is used as a fallback.
   */
  output?: string
}

/**
 * Called before the record is serialized.
 * Return `false` to silently drop this log entry.
 * Return the (optionally mutated) context to continue the pipeline.
 */
export type BeforeWriteHook = (ctx: HookContext) => HookContext | false

/**
 * Called during serialization.
 * Override `ctx.output` to replace the default NDJSON format.
 */
export type SerializeHook = (ctx: HookContext) => HookContext

/**
 * Called after the serialized line has been queued for writing.
 * Intended for side-effects such as forwarding to Sentry or Datadog.
 * Must not throw — wrap your implementation in try/catch.
 */
export type AfterWriteHook = (ctx: HookContext) => void

/** Collection of lifecycle hooks registered on a logger instance. */
export interface Hooks {
  onBeforeWrite?: BeforeWriteHook[]
  onSerialize?:   SerializeHook[]
  onAfterWrite?:  AfterWriteHook[]
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * A transport receives a fully-serialized log line and a reference to the
 * original record, then writes it to some destination (stdout, file, HTTP…).
 *
 * @example
 * ```ts
 * class MyTransport implements Transport {
 *   write(line: string, record: LogRecord): void {
 *     myExternalSink.send(line)
 *   }
 * }
 * ```
 */
export interface Transport {
  /**
   * Write a single serialized log line.
   * Called from the async queue — must be synchronous and non-blocking.
   *
   * @param line   - The serialized JSON line (trailing `\n` included).
   * @param record - The original LogRecord, useful for level-based routing.
   */
  write(line: string, record: LogRecord): void

  /**
   * Flush any internal buffers.
   * Called on graceful shutdown via `logger.flush()`.
   */
  flush?(): Promise<void>

  /** Release file handles, sockets, or other resources. */
  close?(): Promise<void>
}

// ---------------------------------------------------------------------------
// Logger options
// ---------------------------------------------------------------------------

/** Options accepted by `createLogger()` and the `Logger` constructor. */
export interface LoggerOptions {
  /**
   * Minimum level to emit.
   * Records below this level are discarded before serialization.
   * @default 'info'
   */
  level?: LevelName

  /**
   * Static key-value pairs merged into every log record produced by this
   * logger and all its children.
   *
   * @example { app: 'api-server', env: 'production' }
   */
  context?: Record<string, unknown>

  /**
   * One or more transports to write to.
   * Defaults to `[new StdoutTransport()]` when not provided via the factory.
   */
  transports?: Transport[]

  /**
   * Lifecycle hooks to attach on construction.
   * Additional hooks can be appended later with `logger.use(hooks)`.
   */
  hooks?: Hooks

  /**
   * Async queue capacity used for back-pressure control.
   * Must be a power of 2 and >= 2.
   * @default 8192
   */
  queueSize?: number

  /**
   * Called when a hook throws during execution.
   * Receives the phase name and the caught error.
   * Useful for monitoring hook health without crashing the logger.
   */
  onHookError?: ((phase: 'onBeforeWrite' | 'onSerialize' | 'onAfterWrite', error: unknown) => void) | undefined

  /**
   * Called when a log entry is dropped due to queue back-pressure.
   * Receives the total number of dropped entries so far.
   */
  onDrop?: ((dropped: number) => void) | undefined
}
