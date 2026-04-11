/**
 * @file transports/file.ts
 * Transport that appends serialized log lines to a file.
 *
 * Uses Node.js `fs.WriteStream` in append mode (`flags: 'a'`).
 * The stream's internal write buffer absorbs bursts without blocking the
 * event loop, so this transport is safe to use alongside `StdoutTransport`.
 *
 * For log rotation, pair this transport with an external rotator such as
 * `logrotate` (Linux) or `rotating-file-stream` (Node.js).
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { Transport } from '../types';

/** Options for `FileTransport`. */
export interface FileTransportOptions {
  /**
   * Absolute or relative path to the log file.
   * Parent directories are created automatically if they do not exist.
   *
   * @example './logs/app.log'
   */
  path: string;
}

/**
 * Appends each log line to a file using a `fs.WriteStream`.
 *
 * @example
 * ```ts
 * import { createLogger, FileTransport } from 'ligelog'
 *
 * const logger = createLogger({
 *   transports: [new FileTransport({ path: './logs/app.log' })],
 * })
 * ```
 */
export class FileTransport implements Transport {
  private readonly stream: WriteStream;

  constructor({ path }: FileTransportOptions) {
    // Ensure parent directory exists before opening the stream.
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: 'a', encoding: 'utf8' });
  }

  /**
   * Write a serialized log line to the file stream.
   * Delegates to the stream's internal buffer — non-blocking.
   */
  write(line: string): void {
    this.stream.write(line);
  }

  /**
   * Resolve once the stream's internal write buffer has been flushed to the OS.
   * Useful before `close()` or on `SIGTERM`.
   */
  flush(): Promise<void> {
    if (!this.stream.writable || this.stream.writableEnded || this.stream.destroyed) {
      return Promise.resolve();
    }
    if (!this.stream.writableNeedDrain) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.stream.once('drain', resolve));
  }

  /** End the stream and release the file descriptor. */
  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
