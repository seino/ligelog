/**
 * @file tests/test.test.ts
 * Tests for @ligelog/test — CaptureTransport and createTestLogger.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CaptureTransport, createTestLogger } from '../src/index';
import type { LogRecord } from 'ligelog';

// ---------------------------------------------------------------------------
// CaptureTransport
// ---------------------------------------------------------------------------

describe('CaptureTransport', () => {
  let transport: CaptureTransport;

  beforeEach(() => {
    transport = new CaptureTransport();
  });

  it('captures entries via write()', () => {
    const record = { level: 20, lvl: 'info', time: Date.now(), msg: 'hello', pid: 1 } as LogRecord;
    transport.write('{"msg":"hello"}\n', record);

    expect(transport.length).toBe(1);
    expect(transport.getEntries()[0]?.record.msg).toBe('hello');
    expect(transport.getEntries()[0]?.line).toBe('{"msg":"hello"}\n');
  });

  it('getByLevel filters entries by level name', async () => {
    const { logger, transport: t } = createTestLogger({ level: 'debug' });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    await logger.flush();

    expect(t.getByLevel('debug')).toHaveLength(1);
    expect(t.getByLevel('info')).toHaveLength(1);
    expect(t.getByLevel('warn')).toHaveLength(1);
    expect(t.getByLevel('error')).toHaveLength(1);
    expect(t.getByLevel('fatal')).toHaveLength(0);
  });

  it('first() returns the first entry', async () => {
    const { logger, transport: t } = createTestLogger({ level: 'debug' });
    logger.info('first');
    logger.info('second');
    await logger.flush();

    expect(t.first()?.record.msg).toBe('first');
  });

  it('first() returns undefined when empty', () => {
    expect(transport.first()).toBeUndefined();
  });

  it('last() returns the most recent entry', async () => {
    const { logger, transport: t } = createTestLogger({ level: 'debug' });
    logger.info('first');
    logger.info('last');
    await logger.flush();

    expect(t.last()?.record.msg).toBe('last');
  });

  it('last() returns undefined when empty', () => {
    expect(transport.last()).toBeUndefined();
  });

  it('clear() removes all entries', async () => {
    const { logger, transport: t } = createTestLogger({ level: 'debug' });
    logger.info('a');
    logger.info('b');
    await logger.flush();

    expect(t.length).toBe(2);
    t.clear();
    expect(t.length).toBe(0);
    expect(t.getEntries()).toHaveLength(0);
  });

  it('hasMessage checks substring presence', async () => {
    const { logger, transport: t } = createTestLogger();
    logger.info('user login succeeded');
    await logger.flush();

    expect(t.hasMessage('login')).toBe(true);
    expect(t.hasMessage('logout')).toBe(false);
  });

  it('findByMessage with string matches substring', async () => {
    const { logger, transport: t } = createTestLogger();
    logger.info('request started');
    logger.info('request completed');
    logger.info('shutdown');
    await logger.flush();

    const matches = t.findByMessage('request');
    expect(matches).toHaveLength(2);
  });

  it('findByMessage with RegExp matches pattern', async () => {
    const { logger, transport: t } = createTestLogger();
    logger.info('user:123 login');
    logger.info('user:456 login');
    logger.info('system boot');
    await logger.flush();

    const matches = t.findByMessage(/user:\d+ login/);
    expect(matches).toHaveLength(2);
  });

  it('messages() returns flat array of msg values', async () => {
    const { logger, transport: t } = createTestLogger({ level: 'debug' });
    logger.info('a');
    logger.warn('b');
    logger.error('c');
    await logger.flush();

    expect(t.messages()).toEqual(['a', 'b', 'c']);
  });

  it('captured records are frozen (immutable)', async () => {
    const { logger, transport: t } = createTestLogger();
    logger.info('frozen');
    await logger.flush();

    const record = t.first()?.record;
    expect(record).toBeDefined();
    expect(Object.isFrozen(record)).toBe(true);

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (record as any).msg = 'mutated';
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// createTestLogger
// ---------------------------------------------------------------------------

describe('createTestLogger', () => {
  it('respects level option', async () => {
    const { logger, transport } = createTestLogger({ level: 'warn' });
    logger.debug('skip');
    logger.info('skip');
    logger.warn('keep');
    logger.error('keep');
    await logger.flush();

    expect(transport.length).toBe(2);
    expect(transport.messages()).toEqual(['keep', 'keep']);
  });

  it('merges context into records', async () => {
    const { logger, transport } = createTestLogger({ context: { app: 'test-app' } });
    logger.info('ctx');
    await logger.flush();

    expect(transport.first()?.record.app).toBe('test-app');
  });
});
