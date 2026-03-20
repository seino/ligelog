/**
 * @file queue.ts
 * Non-blocking ring-buffer queue for log line dispatch.
 *
 * Design goals:
 * - Zero allocations on the hot path after the initial buffer is created.
 * - Never block the main thread — writes are deferred via `queueMicrotask`.
 * - Bounded memory usage: when the ring is full, incoming entries are dropped
 *   and counted so the caller can detect back-pressure.
 *
 * The queue flushes up to `TICK_LIMIT` entries per microtask tick to avoid
 * starving other microtask-scheduled work (e.g. Promise continuations).
 */

import type { Transport, LogRecord } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default ring buffer capacity. Must be a power of 2. */
const DEFAULT_SIZE = 8192

/**
 * Maximum entries drained per microtask tick.
 * Prevents the flush loop from monopolizing the microtask queue.
 */
const TICK_LIMIT = 512

// ---------------------------------------------------------------------------
// Internal entry shape
// ---------------------------------------------------------------------------

interface QueueEntry {
  /** Serialized NDJSON line ready to hand to transports. */
  line:   string
  /** Original record — passed to `transport.write` for level-based routing. */
  record: LogRecord
}

// ---------------------------------------------------------------------------
// AsyncQueue
// ---------------------------------------------------------------------------

/**
 * A fixed-size ring buffer that dispatches log lines to one or more
 * `Transport` instances asynchronously via `queueMicrotask`.
 *
 * @example
 * ```ts
 * const queue = new AsyncQueue([new StdoutTransport()])
 * queue.enqueue('{"msg":"hello"}\n', record)
 * await queue.drain()
 * ```
 */
export class AsyncQueue {
  private readonly buf: QueueEntry[]
  private readonly mask: number
  private          head    = 0      // write cursor
  private          tail    = 0      // read cursor
  private          running = false  // true while a flush tick is scheduled
  private          dropped = 0      // total entries discarded due to back-pressure
  private          writeErrors = 0  // total transport write failures
  private readonly drainWaiters: Array<() => void> = []

  /** Transports are exposed so child loggers can share the same queue. */
  readonly transports: Transport[]

  constructor(transports: Transport[], size = DEFAULT_SIZE) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new Error('AsyncQueue size must be a power of 2 and >= 2')
    }
    this.buf = new Array<QueueEntry>(size)
    this.mask = size - 1
    this.transports = transports
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Add a serialized line to the queue.
   * If the ring buffer is full the entry is silently dropped and `dropped`
   * is incremented — call `getDropped()` to observe back-pressure.
   *
   * @param line   - Serialized NDJSON line (trailing `\n` included).
   * @param record - Original `LogRecord` forwarded to transports.
   */
  enqueue(line: string, record: LogRecord): void {
    const next = (this.head + 1) & this.mask
    if (next === this.tail) {
      // Ring buffer full — drop and count.
      this.dropped++
      return
    }
    this.buf[this.head] = { line, record }
    this.head = next
    if (!this.running) this.schedule()
  }

  /**
   * Resolve when all currently-queued entries have been written.
   * Safe to call from `process.on('beforeExit', ...)` for graceful shutdown.
   */
  drain(): Promise<void> {
    if (this.tail === this.head) return Promise.resolve()
    return new Promise(resolve => this.drainWaiters.push(resolve))
  }

  /**
   * Total number of entries dropped since this queue was created.
   * A non-zero value indicates back-pressure — consider adding faster
   * transports or raising `queueSize`.
   */
  getDropped(): number {
    return this.dropped
  }

  /** Total number of transport write failures observed by the queue. */
  getWriteErrors(): number {
    return this.writeErrors
  }

  // -------------------------------------------------------------------------
  // Internal flush loop
  // -------------------------------------------------------------------------

  /** Schedule the next flush tick via `queueMicrotask`. */
  private schedule(): void {
    this.running = true
    queueMicrotask(() => this.tick())
  }

  /**
   * Drain up to `TICK_LIMIT` entries then yield.
   * If entries remain, re-schedules itself to avoid starving other microtasks.
   */
  private tick(): void {
    let n = 0
    while (this.tail !== this.head && n++ < TICK_LIMIT) {
      const entry = this.buf[this.tail]
      if (!entry) { this.tail = (this.tail + 1) & this.mask; continue }
      const { line, record } = entry
      this.buf[this.tail] = undefined as unknown as QueueEntry
      this.tail = (this.tail + 1) & this.mask
      for (const t of this.transports) {
        try {
          t.write(line, record)
        } catch {
          // A failing transport must not stall the queue.
          this.writeErrors++
        }
      }
    }

    if (this.tail !== this.head) {
      // More entries waiting — yield and continue.
      queueMicrotask(() => this.tick())
    } else {
      this.running = false
      if (this.drainWaiters.length) {
        const waiters = this.drainWaiters.splice(0, this.drainWaiters.length)
        for (const resolve of waiters) resolve()
      }
    }
  }
}
