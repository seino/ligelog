/**
 * @file shared.ts
 * Shared utilities for HTTP request logging across frameworks.
 *
 * @packageDocumentation
 */

import type { LevelName, LoggerLike } from 'ligelog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options shared across all framework-specific loggers. */
export interface HttpLoggerOptions<TReq = unknown, TRes = unknown> {
  /** Logger instance (or any LoggerLike compatible object). */
  logger: LoggerLike;

  /** Log level for successful responses (2xx/3xx). @default 'info' */
  level?: LevelName;

  /** Log level for client errors (4xx). @default 'warn' */
  clientErrorLevel?: LevelName;

  /** Log level for server errors (5xx). @default 'error' */
  serverErrorLevel?: LevelName;

  /** Header name for request ID. @default 'x-request-id' */
  requestIdHeader?: string;

  /** Custom request ID generator. @default crypto.randomUUID() */
  generateRequestId?: () => string;

  /** Custom serializers for request/response objects. */
  serializers?: {
    req?: (req: TReq) => Record<string, unknown>;
    res?: (res: TRes) => Record<string, unknown>;
  };

  /** Skip logging for certain requests. */
  skip?: (req: TReq, res: TRes) => boolean;

  /**
   * Header names to redact from logs (case-insensitive).
   * @default ['authorization', 'cookie', 'set-cookie']
   */
  redactHeaders?: string[];

  /**
   * Whether to log request/response body.
   * Default is `false` for security — must be explicitly opted in.
   * @default false
   */
  logBody?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REDACT_HEADERS = ['authorization', 'cookie', 'set-cookie'];
const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine log level based on HTTP status code. */
export function levelForStatus(
  status: number,
  level: LevelName = 'info',
  clientErrorLevel: LevelName = 'warn',
  serverErrorLevel: LevelName = 'error'
): LevelName {
  if (status >= 500) return serverErrorLevel;
  if (status >= 400) return clientErrorLevel;
  return level;
}

/** Compute request duration in milliseconds. */
export function computeDuration(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

/**
 * Resolve request ID from header or generate a new one.
 * Validates the header value against a safe pattern.
 */
export function resolveRequestId(
  headerValue: string | undefined | null,
  generateRequestId?: () => string
): { requestId: string; originalRequestId?: string } {
  const generator = generateRequestId ?? defaultGenerateRequestId;

  if (headerValue && REQUEST_ID_PATTERN.test(headerValue)) {
    return { requestId: headerValue };
  }

  const requestId = generator();

  if (headerValue) {
    return { requestId, originalRequestId: headerValue };
  }

  return { requestId };
}

/** Default request ID generator using crypto.randomUUID. */
function defaultGenerateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Redact sensitive headers from a headers object.
 * Returns a new object — does not mutate the input.
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
  redactList?: string[]
): Record<string, string | string[] | undefined> {
  const toRedact = new Set((redactList ?? DEFAULT_REDACT_HEADERS).map((h) => h.toLowerCase()));
  const result: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (toRedact.has(key.toLowerCase()) && value !== undefined) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** Resolved options with defaults applied. */
export interface ResolvedHttpLoggerOptions<TReq = unknown, TRes = unknown> {
  logger: LoggerLike;
  level: LevelName;
  clientErrorLevel: LevelName;
  serverErrorLevel: LevelName;
  requestIdHeader: string;
  generateRequestId: (() => string) | undefined;
  serializers: HttpLoggerOptions<TReq, TRes>['serializers'];
  skip: ((req: TReq, res: TRes) => boolean) | undefined;
  redactHeaders: string[];
  logBody: boolean;
}

/** Resolve options with defaults applied. */
export function resolveOptions<TReq, TRes>(opts: HttpLoggerOptions<TReq, TRes>): ResolvedHttpLoggerOptions<TReq, TRes> {
  return {
    logger: opts.logger,
    level: opts.level ?? 'info',
    clientErrorLevel: opts.clientErrorLevel ?? 'warn',
    serverErrorLevel: opts.serverErrorLevel ?? 'error',
    requestIdHeader: opts.requestIdHeader ?? 'x-request-id',
    generateRequestId: opts.generateRequestId,
    serializers: opts.serializers,
    skip: opts.skip,
    redactHeaders: opts.redactHeaders ?? DEFAULT_REDACT_HEADERS,
    logBody: opts.logBody ?? false,
  };
}
