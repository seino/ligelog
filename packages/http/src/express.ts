/**
 * @file express.ts
 * Express middleware for ligelog HTTP request logging.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog';
 * import { expressLogger } from '@ligelog/http/express';
 *
 * const logger = createLogger();
 * app.use(expressLogger({ logger }));
 *
 * app.get('/api/users', (req, res) => {
 *   req.log.info('handling request');
 *   res.json({ users: [] });
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { LoggerLike } from 'ligelog';
import type { HttpLoggerOptions } from './shared';
import {
  levelForStatus,
  computeDuration,
  resolveRequestId,
  redactHeaders as redactHeadersFn,
  resolveOptions,
} from './shared';

// ---------------------------------------------------------------------------
// Express type definitions (inline to avoid express dependency)
// ---------------------------------------------------------------------------

interface ExpressRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  log?: LoggerLike;
  requestId?: string;
  [key: string]: unknown;
}

interface ExpressResponse {
  statusCode: number;
  getHeaders(): Record<string, string | string[] | number | undefined>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  [key: string]: unknown;
}

type NextFunction = (err?: unknown) => void;
type ExpressMiddleware = (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => void;

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create an Express middleware that logs HTTP requests.
 *
 * Attaches a child logger to `req.log` and `req.requestId` for downstream use.
 * Logs a summary line when the response finishes.
 *
 * @param opts - HTTP logger options.
 * @returns An Express middleware function.
 */
export function expressLogger(opts: HttpLoggerOptions<ExpressRequest, ExpressResponse>): ExpressMiddleware {
  const config = resolveOptions(opts);

  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
    const startTime = performance.now();

    // Resolve request ID
    const headerValue = req.headers[config.requestIdHeader] as string | undefined;
    const { requestId, originalRequestId } = resolveRequestId(headerValue, config.generateRequestId);

    // Attach child logger and request ID
    const childContext: Record<string, unknown> = { requestId };
    if (originalRequestId) {
      childContext.originalRequestId = originalRequestId;
    }
    const childLog = config.logger.child(childContext);
    req.log = childLog;
    req.requestId = requestId;

    // Log on response finish — wrapped in try/catch to prevent
    // serializer errors from crashing the process in event handlers.
    res.on('finish', () => {
      try {
        if (config.skip?.(req, res)) return;

        const duration = computeDuration(startTime);
        const level = levelForStatus(res.statusCode, config.level, config.clientErrorLevel, config.serverErrorLevel);

        const reqData = config.serializers?.req
          ? config.serializers.req(req)
          : {
              method: req.method,
              url: req.url,
              headers: redactHeadersFn(
                req.headers as Record<string, string | string[] | undefined>,
                config.redactHeaders
              ),
            };

        const resData = config.serializers?.res ? config.serializers.res(res) : { statusCode: res.statusCode };

        childLog[level]('request completed', {
          req: reqData,
          res: resData,
          duration,
        });
      } catch {
        // Prevent serializer/skip errors from crashing the process.
        // Logging failures are non-fatal — the response is already sent.
      }
    });

    next();
  };
}
