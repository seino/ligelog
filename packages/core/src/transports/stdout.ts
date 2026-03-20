/**
 * @file transports/stdout.ts
 * Transport that writes serialized log lines to `process.stdout`.
 *
 * This is the default transport used by `createLogger()` when no transports
 * are specified. It calls `process.stdout.write` directly — the fastest
 * synchronous path on Node.js — without any additional buffering.
 *
 * In production, pair this with an external log shipper (Fluentd, Vector,
 * Datadog Agent) that reads from stdout rather than piping Node directly to
 * a remote endpoint.
 */

import type { Transport } from '../types'

/**
 * Writes each log line to `process.stdout` via a single synchronous call.
 *
 * @example
 * ```ts
 * import { createLogger, StdoutTransport } from 'ligelog'
 *
 * const logger = createLogger({ transports: [new StdoutTransport()] })
 * ```
 */
export class StdoutTransport implements Transport {
  /**
   * Write a serialized log line to stdout.
   * The trailing newline is already included in `line` by the serializer.
   */
  write(line: string): void {
    process.stdout.write(line)
  }
}
