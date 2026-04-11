/**
 * @file index.ts
 * Test utilities for ligelog — CaptureTransport and createTestLogger helper.
 *
 * Captures log entries in memory for assertion in tests. Each captured record
 * is frozen via `Object.freeze` to prevent accidental mutation.
 *
 * ## Setup
 *
 * ```ts
 * import { createTestLogger } from '@ligelog/test';
 *
 * const { logger, transport } = createTestLogger({ level: 'debug' });
 * logger.info('hello');
 * await logger.flush();
 * expect(transport.last()?.record.msg).toBe('hello');
 * ```
 *
 * @packageDocumentation
 */

import type { Transport, LogRecord, LevelName, LoggerOptions } from 'ligelog';
import { createLogger } from 'ligelog';
import type { Logger } from 'ligelog';

// ---------------------------------------------------------------------------
// CapturedEntry
// ---------------------------------------------------------------------------

/** A single captured log entry with the serialized line and frozen record. */
export interface CapturedEntry {
  readonly line: string;
  readonly record: Readonly<LogRecord>;
}

// ---------------------------------------------------------------------------
// CaptureTransport
// ---------------------------------------------------------------------------

/**
 * In-memory transport that captures log entries for test assertions.
 *
 * Each record is frozen on capture to guarantee immutability — any attempt
 * to mutate a captured record will throw a `TypeError`.
 */
export class CaptureTransport implements Transport {
  private entries: CapturedEntry[] = [];

  write(line: string, record: LogRecord): void {
    this.entries.push({
      line,
      record: Object.freeze({ ...record }),
    });
  }

  /** All captured entries in insertion order. */
  getEntries(): ReadonlyArray<CapturedEntry> {
    return this.entries;
  }

  /** Filter entries by log level name. */
  getByLevel(level: LevelName): ReadonlyArray<CapturedEntry> {
    return this.entries.filter((e) => e.record.lvl === level);
  }

  /** The first captured entry, or `undefined` if empty. */
  first(): CapturedEntry | undefined {
    return this.entries[0];
  }

  /** The most recently captured entry, or `undefined` if empty. */
  last(): CapturedEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** Number of captured entries. */
  get length(): number {
    return this.entries.length;
  }

  /** Remove all captured entries. */
  clear(): void {
    this.entries = [];
  }

  /** Check if any captured entry contains the given substring in its `msg`. */
  hasMessage(substring: string): boolean {
    return this.entries.some((e) => e.record.msg.includes(substring));
  }

  /** Find entries whose `msg` matches a string (substring) or RegExp. */
  findByMessage(pattern: string | RegExp): ReadonlyArray<CapturedEntry> {
    if (typeof pattern === 'string') {
      return this.entries.filter((e) => e.record.msg.includes(pattern));
    }
    return this.entries.filter((e) => pattern.test(e.record.msg));
  }

  /** Extract all `msg` values as a flat array for quick assertions. */
  messages(): readonly string[] {
    return this.entries.map((e) => e.record.msg);
  }
}

// ---------------------------------------------------------------------------
// TestLoggerSetup
// ---------------------------------------------------------------------------

/** Return type of `createTestLogger`. */
export interface TestLoggerSetup {
  logger: Logger;
  transport: CaptureTransport;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a logger pre-configured with a `CaptureTransport` for testing.
 *
 * @param opts - Logger options (excluding `transports`, which is set automatically).
 * @returns A `{ logger, transport }` pair.
 *
 * @example
 * ```ts
 * const { logger, transport } = createTestLogger({ level: 'debug' });
 * logger.warn('oops');
 * await logger.flush();
 * expect(transport.messages()).toEqual(['oops']);
 * ```
 */
export function createTestLogger(opts: Omit<LoggerOptions, 'transports'> = {}): TestLoggerSetup {
  const transport = new CaptureTransport();
  const logger = createLogger({ ...opts, transports: [transport] });
  return { logger, transport };
}
