/**
 * @file index.ts
 * File rotation transport for ligelog.
 *
 * Supports size-based and time-based rotation with configurable
 * retention policy. Zero external dependencies.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog'
 * import { RotateTransport } from '@ligelog/rotate'
 *
 * const logger = createLogger({
 *   transports: [
 *     new RotateTransport({
 *       path: './logs/app.log',
 *       maxSize: '10MB',
 *       rotateInterval: 'daily',
 *       maxFiles: 7,
 *     }),
 *   ],
 * })
 * ```
 *
 * @packageDocumentation
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, basename, extname, join } from 'node:path';
import type { Transport, LogRecord } from 'ligelog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Size specification — number (bytes) or string with unit. */
export type SizeSpec = number | `${number}${'B' | 'KB' | 'MB' | 'GB'}`;

/** Time-based rotation interval. */
export type RotateInterval = 'hourly' | 'daily' | 'weekly' | 'monthly';

/** Options accepted by `RotateTransport`. */
export interface RotateTransportOptions {
  /**
   * Base file path for the log file.
   * Parent directories are created automatically.
   */
  path: string;

  /**
   * Size threshold that triggers rotation.
   * Accepts bytes (number) or a string like `'10MB'`.
   */
  maxSize?: SizeSpec;

  /**
   * Time interval that triggers rotation.
   */
  rotateInterval?: RotateInterval;

  /**
   * Maximum number of rotated files to keep.
   * `0` means unlimited.
   * @default 0
   */
  maxFiles?: number;

  /**
   * Naming scheme for rotated files.
   * - `'timestamp'` — `app.2024-01-15T09-13-20.log`
   * - `'numeric'` — `app.1.log`, `app.2.log`, …
   * @default 'timestamp'
   */
  namingScheme?: 'timestamp' | 'numeric';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

/** Parse a SizeSpec into bytes. */
export function parseSizeSpec(spec: SizeSpec): number {
  if (typeof spec === 'number') return spec;

  const match = spec.match(/^(\d+(?:\.\d+)?)(B|KB|MB|GB)$/);
  if (!match) throw new Error(`Invalid size spec: ${spec}`);

  const value = parseFloat(match[1]!);
  const unit = match[2]!;
  return Math.floor(value * SIZE_UNITS[unit]!);
}

/** Get the start-of-period timestamp for interval comparison. */
function getPeriodStart(time: number, interval: RotateInterval): number {
  const d = new Date(time);

  switch (interval) {
    case 'hourly':
      d.setMinutes(0, 0, 0);
      return d.getTime();
    case 'daily':
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    case 'weekly': {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d.getTime();
    }
    case 'monthly':
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d.getTime();
  }
}

/** Generate a rotated file name. */
function rotatedName(
  basePath: string,
  scheme: 'timestamp' | 'numeric',
  index: number,
): string {
  const dir = dirname(basePath);
  const ext = extname(basePath);
  const base = basename(basePath, ext);

  if (scheme === 'numeric') {
    return join(dir, `${base}.${index}${ext}`);
  }

  // timestamp scheme
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(dir, `${base}.${ts}${ext}`);
}

/** Check if a file name matches the rotated file pattern. */
function isRotatedFile(fileName: string, basePath: string): boolean {
  const ext = extname(basePath);
  const base = basename(basePath, ext);
  const prefix = base + '.';

  return fileName.startsWith(prefix) && fileName.endsWith(ext) && fileName !== basename(basePath);
}

/**
 * Extract the numeric index from a rotated file name (e.g. `app.12.log` → 12).
 * Returns `NaN` for non-numeric names (timestamp scheme).
 */
function extractNumericIndex(fileName: string, basePath: string): number {
  const ext = extname(basePath);
  const base = basename(basePath, ext);
  const middle = fileName.slice(base.length + 1, fileName.length - ext.length);
  return parseInt(middle, 10);
}

/**
 * Sort rotated file names in ascending order (oldest first).
 * Numeric names are sorted by index; timestamp names by lexicographic order.
 */
function sortRotatedFiles(files: string[], basePath: string): string[] {
  return files.sort((a, b) => {
    const idxA = extractNumericIndex(a, basePath);
    const idxB = extractNumericIndex(b, basePath);

    // Both numeric — sort by index
    if (!isNaN(idxA) && !isNaN(idxB)) return idxA - idxB;

    // Fallback to lexicographic (works for ISO timestamp names)
    return a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// RotateTransport
// ---------------------------------------------------------------------------

/**
 * File transport with automatic log rotation.
 *
 * Rotation triggers on:
 * - **Size**: when current file exceeds `maxSize` bytes.
 * - **Time**: when the record's timestamp crosses an interval boundary.
 *
 * Rotated files are named by timestamp or numeric index. Old files beyond
 * `maxFiles` are automatically deleted.
 *
 * **Performance note:** This transport uses synchronous I/O (`writeSync`)
 * to guarantee data is flushed to disk before rotation. This makes it
 * reliable but unsuitable for ultra-high-throughput scenarios where
 * event-loop blocking is a concern. For those cases, consider the core
 * `FileTransport` (async `WriteStream`) with external log rotation.
 *
 * @example
 * ```ts
 * new RotateTransport({
 *   path: './logs/app.log',
 *   maxSize: '50MB',
 *   rotateInterval: 'daily',
 *   maxFiles: 30,
 * })
 * ```
 */
export class RotateTransport implements Transport {
  private fd: number;
  private closed: boolean;
  private currentSize: number;
  private lastPeriodStart: number;
  private rotateIndex: number;

  private readonly basePath: string;
  private readonly maxSizeBytes: number;
  private readonly interval: RotateInterval | undefined;
  private readonly maxFiles: number;
  private readonly namingScheme: 'timestamp' | 'numeric';

  constructor(opts: RotateTransportOptions) {
    this.basePath = opts.path;
    this.maxSizeBytes = opts.maxSize ? parseSizeSpec(opts.maxSize) : Infinity;
    this.interval = opts.rotateInterval;
    this.maxFiles = opts.maxFiles ?? 0;
    this.namingScheme = opts.namingScheme ?? 'timestamp';
    this.rotateIndex = 0;
    this.closed = false;

    // Ensure parent directory exists
    mkdirSync(dirname(this.basePath), { recursive: true });

    // Get current file size if it exists
    try {
      const stat = statSync(this.basePath);
      this.currentSize = stat.size;
    } catch {
      // File does not exist yet — start with zero size.
      this.currentSize = 0;
    }

    // Set on first write so period tracking aligns with actual log timestamps
    this.lastPeriodStart = 0;

    this.fd = openSync(this.basePath, 'a');
  }

  /**
   * Write a log line, rotating the file if size or time thresholds are met.
   * Uses synchronous I/O to guarantee data is on disk before rotation.
   */
  write(line: string, record: LogRecord): void {
    const lineBytes = Buffer.byteLength(line, 'utf8');

    // Check size-based rotation
    if (this.currentSize + lineBytes > this.maxSizeBytes && this.currentSize > 0) {
      this.rotate();
    }

    // Check time-based rotation
    if (this.interval) {
      const currentPeriod = getPeriodStart(record.time, this.interval);
      if (this.lastPeriodStart === 0) {
        this.lastPeriodStart = currentPeriod;
      } else if (currentPeriod !== this.lastPeriodStart && this.currentSize > 0) {
        this.rotate();
        this.lastPeriodStart = currentPeriod;
      }
    }

    writeSync(this.fd, line);
    this.currentSize += lineBytes;
  }

  /** Manually trigger a file rotation. */
  rotate(): void {
    // Close the current fd so all data is flushed to disk
    closeSync(this.fd);

    // Generate rotated file name and rename
    this.rotateIndex += 1;
    const rotatedPath = rotatedName(this.basePath, this.namingScheme, this.rotateIndex);
    renameSync(this.basePath, rotatedPath);

    // Open a fresh fd
    this.fd = openSync(this.basePath, 'a');
    this.currentSize = 0;

    // Cleanup old files if maxFiles is set
    if (this.maxFiles > 0) {
      this.cleanup();
    }
  }

  /** No-op — writes are synchronous, no buffered data to flush. */
  flush(): Promise<void> {
    return Promise.resolve();
  }

  /** Close the file descriptor. */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    closeSync(this.fd);
    return Promise.resolve();
  }

  /** Delete rotated files beyond `maxFiles` limit. */
  private cleanup(): void {
    const dir = dirname(this.basePath);

    let files: string[];
    try {
      files = sortRotatedFiles(
        readdirSync(dir).filter((f) => isRotatedFile(f, this.basePath)),
        this.basePath,
      );
    } catch {
      // Directory may have been removed externally — nothing to clean up.
      return;
    }

    const excess = files.length - this.maxFiles;
    if (excess <= 0) return;

    for (let i = 0; i < excess; i++) {
      try {
        unlinkSync(join(dir, files[i]!));
      } catch {
        // Best-effort cleanup — file may already be deleted or locked.
      }
    }
  }
}
