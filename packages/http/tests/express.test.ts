/**
 * @file tests/express.test.ts
 * Tests for @ligelog/http Express middleware.
 */

import { describe, it, expect, vi } from 'vitest';
import { expressLogger } from '../src/express';
import type { LoggerLike } from 'ligelog';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockLogger(): LoggerLike & {
  calls: Array<{ level: string; msg: string; fields?: Record<string, unknown> }>;
  childCalls: Array<Record<string, unknown>>;
} {
  const calls: Array<{ level: string; msg: string; fields?: Record<string, unknown> }> = [];
  const childCalls: Array<Record<string, unknown>> = [];

  const makeLogger = (
    context: Record<string, unknown> = {}
  ): LoggerLike & {
    calls: typeof calls;
    childCalls: typeof childCalls;
  } => {
    const logger: LoggerLike & { calls: typeof calls; childCalls: typeof childCalls } = {
      calls,
      childCalls,
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
        childCalls.push(ctx);
        return makeLogger({ ...context, ...ctx });
      },
    };
    return logger;
  };

  return makeLogger();
}

interface MockReq {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  log?: LoggerLike;
  requestId?: string;
  [key: string]: unknown;
}

interface MockRes extends EventEmitter {
  statusCode: number;
  getHeaders(): Record<string, string | string[] | number | undefined>;
  [key: string]: unknown;
}

function createMockReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method: 'GET',
    url: '/api/users',
    headers: { host: 'localhost:3000' },
    ...overrides,
  };
}

function createMockRes(statusCode = 200): MockRes {
  const res = new EventEmitter() as MockRes;
  res.statusCode = statusCode;
  res.getHeaders = () => ({});
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('expressLogger', () => {
  it('attaches req.log and req.requestId', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(req.log).toBeDefined();
    expect(req.requestId).toBeTruthy();
    expect(next).toHaveBeenCalledOnce();
  });

  it('logs on response finish with correct level', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq();
    const res = createMockRes(200);
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.level).toBe('info');
    expect(logger.calls[0]?.msg).toBe('request completed');
  });

  it('uses warn for 4xx responses', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq();
    const res = createMockRes(404);
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(logger.calls[0]?.level).toBe('warn');
  });

  it('uses error for 5xx responses', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq();
    const res = createMockRes(500);
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(logger.calls[0]?.level).toBe('error');
  });

  it('uses x-request-id from header when valid', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq({ headers: { host: 'localhost', 'x-request-id': 'req-abc-123' } });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(req.requestId).toBe('req-abc-123');
  });

  it('skips logging when skip returns true', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({
      logger,
      skip: (req) => req.url === '/health',
    });
    const req = createMockReq({ url: '/health' });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(logger.calls).toHaveLength(0);
  });

  it('redacts authorization header by default', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq({
      headers: { host: 'localhost', authorization: 'Bearer secret-token' },
    });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    const fields = logger.calls[0]?.fields;
    const reqObj = fields?.req as Record<string, unknown>;
    const headers = reqObj?.headers as Record<string, unknown>;
    expect(headers?.authorization).toBe('[REDACTED]');
  });

  it('includes duration in the log', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({ logger });
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.emit('finish');

    const fields = logger.calls[0]?.fields;
    expect(typeof fields?.duration).toBe('number');
    expect(fields?.duration as number).toBeGreaterThanOrEqual(0);
  });

  it('does not crash when serializer throws in finish handler', () => {
    const logger = createMockLogger();
    const middleware = expressLogger({
      logger,
      serializers: {
        req: () => {
          throw new Error('serializer boom');
        },
      },
    });
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    // Should not throw — error is caught inside the finish handler
    expect(() => res.emit('finish')).not.toThrow();
    // No log emitted since serializer failed
    expect(logger.calls).toHaveLength(0);
  });
});
