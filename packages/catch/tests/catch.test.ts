/**
 * @file tests/catch.test.ts
 * Tests for catchWith and catchAsync.
 */

import { describe, it, expect, vi } from 'vitest';
import { catchWith, catchAsync } from '../src/index';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// catchWith (sync)
// ---------------------------------------------------------------------------

describe('catchWith', () => {
  it('returns the original value on success', () => {
    const logger = makeLogger();
    const add = (a: number, b: number) => a + b;
    const safe = catchWith(logger, add);

    expect(safe(2, 3)).toBe(5);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and rethrows by default', () => {
    const logger = makeLogger();
    const boom = () => { throw new Error('boom'); };
    const safe = catchWith(logger, boom);

    expect(() => safe()).toThrow('boom');
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      'Caught exception in boom',
      expect.objectContaining({ fn: 'boom' }),
    );
  });

  it('swallows error and returns undefined when rethrow: false', () => {
    const logger = makeLogger();
    const boom = () => { throw new Error('fail'); };
    const safe = catchWith(logger, boom, { rethrow: false });

    expect(safe()).toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('uses custom level', () => {
    const logger = makeLogger();
    const boom = () => { throw new Error('x'); };
    const safe = catchWith(logger, boom, { level: 'fatal', rethrow: false });

    safe();
    expect(logger.fatal).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses custom message', () => {
    const logger = makeLogger();
    const boom = () => { throw new Error('x'); };
    const safe = catchWith(logger, boom, { message: 'Custom msg', rethrow: false });

    safe();
    expect(logger.error).toHaveBeenCalledWith(
      'Custom msg',
      expect.any(Object),
    );
  });

  it('includes extra context from extra function', () => {
    const logger = makeLogger();
    const boom = (id: string) => { throw new Error('not found'); };
    const safe = catchWith(logger, boom, {
      rethrow: false,
      extra: (_err, args) => ({ id: args[0] }),
    });

    safe('user-123');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'user-123' }),
    );
  });

  it('preserves this context', () => {
    const logger = makeLogger();
    const obj = {
      value: 42,
      getValue(this: { value: number }) { return this.value; },
    };
    const safe = catchWith(logger, obj.getValue);

    expect(safe.call(obj)).toBe(42);
  });

  it('handles anonymous functions', () => {
    const logger = makeLogger();
    const safe = catchWith(logger, () => { throw new Error('anon'); }, { rethrow: false });

    safe();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Caught exception'),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// catchAsync
// ---------------------------------------------------------------------------

describe('catchAsync', () => {
  it('returns the resolved value on success', async () => {
    const logger = makeLogger();
    const fetchData = async (id: string) => ({ id, name: 'test' });
    const safe = catchAsync(logger, fetchData);

    const result = await safe('123');
    expect(result).toEqual({ id: '123', name: 'test' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and rethrows rejected promises by default', async () => {
    const logger = makeLogger();
    const boom = async () => { throw new Error('async boom'); };
    const safe = catchAsync(logger, boom);

    await expect(safe()).rejects.toThrow('async boom');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('swallows rejection and returns undefined when rethrow: false', async () => {
    const logger = makeLogger();
    const boom = async () => { throw new Error('async fail'); };
    const safe = catchAsync(logger, boom, { rethrow: false });

    const result = await safe();
    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('uses custom level for async errors', async () => {
    const logger = makeLogger();
    const boom = async () => { throw new Error('x'); };
    const safe = catchAsync(logger, boom, { level: 'warn', rethrow: false });

    await safe();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('includes extra context from extra function', async () => {
    const logger = makeLogger();
    const boom = async (url: string) => { throw new Error('fetch failed'); };
    const safe = catchAsync(logger, boom, {
      rethrow: false,
      extra: (_err, args) => ({ url: args[0] }),
    });

    await safe('/api/users');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ url: '/api/users' }),
    );
  });

  it('preserves this context for async methods', async () => {
    const logger = makeLogger();
    const obj = {
      value: 99,
      async getValue(this: { value: number }) { return this.value; },
    };
    const safe = catchAsync(logger, obj.getValue);

    expect(await safe.call(obj)).toBe(99);
  });
});
