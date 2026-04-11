/**
 * @file tests/shared.test.ts
 * Tests for @ligelog/http shared utilities.
 */

import { describe, it, expect } from 'vitest';
import { levelForStatus, computeDuration, resolveRequestId, redactHeaders } from '../src/shared';

describe('levelForStatus', () => {
  it('returns info for 2xx', () => {
    expect(levelForStatus(200)).toBe('info');
    expect(levelForStatus(201)).toBe('info');
    expect(levelForStatus(299)).toBe('info');
  });

  it('returns info for 3xx', () => {
    expect(levelForStatus(301)).toBe('info');
    expect(levelForStatus(304)).toBe('info');
  });

  it('returns warn for 4xx', () => {
    expect(levelForStatus(400)).toBe('warn');
    expect(levelForStatus(404)).toBe('warn');
    expect(levelForStatus(499)).toBe('warn');
  });

  it('returns error for 5xx', () => {
    expect(levelForStatus(500)).toBe('error');
    expect(levelForStatus(503)).toBe('error');
  });

  it('accepts custom level overrides', () => {
    expect(levelForStatus(200, 'debug')).toBe('debug');
    expect(levelForStatus(400, 'info', 'error')).toBe('error');
    expect(levelForStatus(500, 'info', 'warn', 'fatal')).toBe('fatal');
  });
});

describe('computeDuration', () => {
  it('returns a non-negative integer', () => {
    const start = performance.now();
    const duration = computeDuration(start);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(duration)).toBe(true);
  });
});

describe('resolveRequestId', () => {
  it('uses header value when valid', () => {
    const result = resolveRequestId('abc-123');
    expect(result.requestId).toBe('abc-123');
    expect(result.originalRequestId).toBeUndefined();
  });

  it('generates new ID when header is missing', () => {
    const result = resolveRequestId(undefined);
    expect(result.requestId).toBeTruthy();
    expect(result.originalRequestId).toBeUndefined();
  });

  it('generates new ID when header is null', () => {
    const result = resolveRequestId(null);
    expect(result.requestId).toBeTruthy();
  });

  it('rejects invalid header value and preserves original', () => {
    const result = resolveRequestId('<script>alert("xss")</script>');
    expect(result.requestId).toBeTruthy();
    expect(result.requestId).not.toBe('<script>alert("xss")</script>');
    expect(result.originalRequestId).toBe('<script>alert("xss")</script>');
  });

  it('rejects overly long header value', () => {
    const longId = 'a'.repeat(200);
    const result = resolveRequestId(longId);
    expect(result.requestId).not.toBe(longId);
    expect(result.originalRequestId).toBe(longId);
  });

  it('uses custom generator when provided', () => {
    const result = resolveRequestId(undefined, () => 'custom-id-1');
    expect(result.requestId).toBe('custom-id-1');
  });
});

describe('redactHeaders', () => {
  it('redacts default sensitive headers', () => {
    const headers = {
      authorization: 'Bearer token123',
      cookie: 'sid=abc',
      'set-cookie': 'sid=xyz',
      host: 'example.com',
      'content-type': 'application/json',
    };

    const result = redactHeaders(headers);
    expect(result.authorization).toBe('[REDACTED]');
    expect(result.cookie).toBe('[REDACTED]');
    expect(result['set-cookie']).toBe('[REDACTED]');
    expect(result.host).toBe('example.com');
    expect(result['content-type']).toBe('application/json');
  });

  it('is case-insensitive', () => {
    const result = redactHeaders({ Authorization: 'Bearer x' });
    expect(result.Authorization).toBe('[REDACTED]');
  });

  it('accepts custom redact list', () => {
    const result = redactHeaders({ 'x-api-key': 'secret', host: 'example.com' }, ['x-api-key']);
    expect(result['x-api-key']).toBe('[REDACTED]');
    expect(result.host).toBe('example.com');
  });

  it('does not mutate input', () => {
    const headers = { authorization: 'Bearer x' };
    redactHeaders(headers);
    expect(headers.authorization).toBe('Bearer x');
  });

  it('skips undefined values', () => {
    const result = redactHeaders({ authorization: undefined });
    expect(result.authorization).toBeUndefined();
  });
});
