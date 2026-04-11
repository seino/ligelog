/**
 * @file hono.ts
 * Hono middleware for ligelog HTTP request logging.
 *
 * Edge Runtime / Cloudflare Workers compatible — uses only
 * `globalThis.crypto.randomUUID()` and `performance.now()`.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog';
 * import { honoLogger } from '@ligelog/http/hono';
 * import { Hono } from 'hono';
 *
 * const logger = createLogger();
 * const app = new Hono();
 * app.use(honoLogger({ logger }));
 *
 * app.get('/api/users', (c) => {
 *   c.get('log').info('handling request');
 *   return c.json({ users: [] });
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { HttpLoggerOptions } from './shared';
import {
  levelForStatus,
  computeDuration,
  resolveRequestId,
  redactHeaders as redactHeadersFn,
  resolveOptions,
} from './shared';

// ---------------------------------------------------------------------------
// Hono type definitions (inline to keep hono as optional peer dep)
// ---------------------------------------------------------------------------

interface HonoRequest {
  method: string;
  url: string;
  path: string;
  header(name: string): string | undefined;
  raw: { headers: Headers };
}

interface HonoContext {
  req: HonoRequest;
  res: Response;
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

type HonoNext = () => Promise<void>;
type HonoMiddleware = (c: HonoContext, next: HonoNext) => Promise<void>;

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono middleware that logs HTTP requests.
 *
 * Stores a child logger at `c.get('log')` and request ID at `c.get('requestId')`.
 * Logs a summary line after the response is sent.
 * Always attempts to log even if the downstream handler throws.
 *
 * @param opts - HTTP logger options.
 * @returns A Hono middleware function.
 */
export function honoLogger(opts: HttpLoggerOptions<HonoRequest, Response>): HonoMiddleware {
  const config = resolveOptions(opts);

  return async (c: HonoContext, next: HonoNext): Promise<void> => {
    const startTime = performance.now();

    // Resolve request ID
    const headerValue = c.req.header(config.requestIdHeader);
    const { requestId, originalRequestId } = resolveRequestId(headerValue, config.generateRequestId);

    // Attach child logger and request ID to context
    const childContext: Record<string, unknown> = { requestId };
    if (originalRequestId) {
      childContext.originalRequestId = originalRequestId;
    }
    const childLog = config.logger.child(childContext);
    c.set('log', childLog);
    c.set('requestId', requestId);

    // Execute downstream handlers, always log afterward
    let handlerError: unknown;
    try {
      await next();
    } catch (err) {
      handlerError = err;
    }

    // Attempt to log even after handler errors
    try {
      if (config.skip?.(c.req, c.res)) {
        if (handlerError) throw handlerError;
        return;
      }

      const status = c.res?.status ?? 500;
      const level = levelForStatus(status, config.level, config.clientErrorLevel, config.serverErrorLevel);

      // Build request data
      let reqData: Record<string, unknown>;
      if (config.serializers?.req) {
        reqData = config.serializers.req(c.req);
      } else {
        const headersObj: Record<string, string> = {};
        c.req.raw.headers.forEach((value, key) => {
          headersObj[key] = value;
        });

        reqData = {
          method: c.req.method,
          url: c.req.url,
          path: c.req.path,
          headers: redactHeadersFn(headersObj, config.redactHeaders),
        };
      }

      // Build response data
      const resData: Record<string, unknown> = config.serializers?.res
        ? config.serializers.res(c.res)
        : { statusCode: status };

      const duration = computeDuration(startTime);

      childLog[level]('request completed', {
        req: reqData,
        res: resData,
        duration,
      });
    } catch (logError) {
      // If handler threw, re-throw it. Logging errors are secondary.
      if (handlerError) throw handlerError;
      throw logError;
    }

    if (handlerError) throw handlerError;
  };
}
