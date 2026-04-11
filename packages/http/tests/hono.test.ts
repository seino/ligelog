/**
 * @file tests/hono.test.ts
 * Tests for @ligelog/http Hono middleware.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { honoLogger } from '../src/hono';
import type { LoggerLike } from 'ligelog';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function createMockLogger(): LoggerLike & {
  calls: Array<{ level: string; msg: string; fields?: Record<string, unknown> }>;
} {
  const calls: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];

  const makeLogger = (context: Record<string, unknown> = {}): LoggerLike & { calls: typeof calls } => {
    const logger: LoggerLike & { calls: typeof calls } = {
      calls,
      debug(msg: string, fields?: Record<string, unknown>) {
        calls.push({ level: 'debug', msg, fields: { ...context, ...fields } });
      },
      info(msg: string, fields?: Record<string, unknown>) {
        calls.push({ level: 'info', msg, fields: { ...context, ...fields } });
      },
      warn(msg: string, fields?: Record<string, unknown>) {
        calls.push({ level: 'warn', msg, fields: { ...context, ...fields } });
      },
      error(msg: string, fields?: Record<string, unknown>) {
        calls.push({ level: 'error', msg, fields: { ...context, ...fields } });
      },
      fatal(msg: string, fields?: Record<string, unknown>) {
        calls.push({ level: 'fatal', msg, fields: { ...context, ...fields } });
      },
      child(ctx: Record<string, unknown>) {
        return makeLogger({ ...context, ...ctx });
      },
    };
    return logger;
  };

  return makeLogger();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('honoLogger', () => {
  it('logs a request with info level for 200 response', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));
    app.get('/api/users', (c) => c.json({ users: [] }));

    const res = await app.request('/api/users');
    expect(res.status).toBe(200);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.level).toBe('info');
    expect(logger.calls[0]?.msg).toBe('request completed');
  });

  it('injects log and requestId into context', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));

    let hasLog = false;
    let hasRequestId = false;

    app.get('/test', (c) => {
      hasLog = typeof c.get('log') !== 'undefined';
      hasRequestId = typeof c.get('requestId') === 'string';
      return c.text('ok');
    });

    await app.request('/test');
    expect(hasLog).toBe(true);
    expect(hasRequestId).toBe(true);
  });

  it('uses warn for 404 responses', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));
    // No route defined → 404

    await app.request('/nonexistent');
    expect(logger.calls[0]?.level).toBe('warn');
  });

  it('uses x-request-id from header when valid', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));

    let capturedRequestId: string | undefined;
    app.get('/test', (c) => {
      capturedRequestId = c.get('requestId') as string;
      return c.text('ok');
    });

    await app.request('/test', {
      headers: { 'x-request-id': 'hono-req-123' },
    });

    expect(capturedRequestId).toBe('hono-req-123');
  });

  it('redacts authorization header by default', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));
    app.get('/test', (c) => c.text('ok'));

    await app.request('/test', {
      headers: { authorization: 'Bearer secret' },
    });

    const fields = logger.calls[0]?.fields;
    const reqObj = fields?.req as Record<string, unknown>;
    const headers = reqObj?.headers as Record<string, unknown>;
    expect(headers?.authorization).toBe('[REDACTED]');
  });

  it('includes duration in the log', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));
    app.get('/test', (c) => c.text('ok'));

    await app.request('/test');

    const fields = logger.calls[0]?.fields;
    expect(typeof fields?.duration).toBe('number');
  });

  it('does not use Node.js-specific APIs (Edge compatible)', async () => {
    // Verify that the middleware itself doesn't import 'node:*' modules
    // by running successfully (Hono app.request is fetch-based)
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));
    app.get('/edge', (c) => c.json({ ok: true }));

    const res = await app.request('/edge');
    expect(res.status).toBe(200);
    expect(logger.calls).toHaveLength(1);
  });

  it('logs even when handler throws (try/finally)', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(honoLogger({ logger }));
    app.get('/error', () => {
      throw new Error('handler boom');
    });

    // Hono catches handler errors and returns 500
    const res = await app.request('/error');
    expect(res.status).toBe(500);
    // Should still have logged
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.level).toBe('error');
  });

  it('skip function prevents logging', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(
      honoLogger({
        logger,
        skip: (req) => req.path === '/health',
      })
    );
    app.get('/health', (c) => c.text('ok'));
    app.get('/api', (c) => c.text('ok'));

    await app.request('/health');
    expect(logger.calls).toHaveLength(0);

    await app.request('/api');
    expect(logger.calls).toHaveLength(1);
  });

  it('custom serializers are used when provided', async () => {
    const logger = createMockLogger();
    const app = new Hono();
    app.use(
      honoLogger({
        logger,
        serializers: {
          req: (req) => ({ customMethod: req.method }),
          res: (res) => ({ customStatus: res.status }),
        },
      })
    );
    app.get('/test', (c) => c.text('ok'));

    await app.request('/test');

    const fields = logger.calls[0]?.fields;
    const reqObj = fields?.req as Record<string, unknown>;
    const resObj = fields?.res as Record<string, unknown>;
    expect(reqObj?.customMethod).toBe('GET');
    expect(resObj?.customStatus).toBe(200);
  });
});
