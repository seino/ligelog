/**
 * @file index.ts
 * Public API surface for @ligelog/http.
 *
 * Exports shared types and utilities. Framework-specific middleware is
 * available via subpath imports:
 *
 * ```ts
 * import { expressLogger } from '@ligelog/http/express';
 * import { honoLogger } from '@ligelog/http/hono';
 * ```
 *
 * @packageDocumentation
 */

export type { HttpLoggerOptions } from './shared';
export { levelForStatus, computeDuration, resolveRequestId, redactHeaders } from './shared';
