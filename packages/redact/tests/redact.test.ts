/**
 * @file tests/redact.test.ts
 * Tests for @ligelog/redact — PII field masking hook.
 */

import { describe, it, expect } from 'vitest';
import { createRedactHook } from '../src/index';
import { createLogger } from 'ligelog';
import type { LogRecord, Transport } from 'ligelog';

// ---------------------------------------------------------------------------
// In-memory transport for testing
// ---------------------------------------------------------------------------

class MemoryTransport implements Transport {
  readonly lines: string[] = [];
  readonly records: LogRecord[] = [];

  write(line: string, record: LogRecord): void {
    this.lines.push(line);
    this.records.push(record);
  }
}

async function logAndFlush(
  paths: string[],
  msg: string,
  fields: Record<string, unknown>,
  opts: { censor?: string | ((value: unknown, path: string) => unknown); remove?: boolean } = {}
): Promise<{ records: LogRecord[]; lines: string[] }> {
  const mem = new MemoryTransport();
  const logger = createLogger({ transports: [mem] });
  logger.use(createRedactHook({ paths, ...opts }));
  logger.info(msg, fields);
  await logger.flush();
  return { records: mem.records, lines: mem.lines };
}

// ---------------------------------------------------------------------------
// Basic redaction
// ---------------------------------------------------------------------------

describe('@ligelog/redact — basic', () => {
  it('redacts a top-level field', async () => {
    const { records, lines } = await logAndFlush(['password'], 'login', { password: 'secret123' });

    expect(records[0]?.password).toBe('[REDACTED]');
    expect(lines[0]).toContain('"[REDACTED]"');
    expect(lines[0]).not.toContain('secret123');
  });

  it('redacts a nested field with dot path', async () => {
    const { records } = await logAndFlush(['user.password'], 'login', {
      user: { name: 'Alice', password: 'secret' },
    });

    const user = records[0]?.user as Record<string, unknown>;
    expect(user.name).toBe('Alice');
    expect(user.password).toBe('[REDACTED]');
  });

  it('redacts multiple paths', async () => {
    const { records } = await logAndFlush(['password', 'token'], 'auth', {
      password: 's1',
      token: 't1',
      username: 'bob',
    });

    expect(records[0]?.password).toBe('[REDACTED]');
    expect(records[0]?.token).toBe('[REDACTED]');
    expect(records[0]?.username).toBe('bob');
  });

  it('returns empty hooks when paths is empty', () => {
    const hooks = createRedactHook({ paths: [] });
    expect(hooks.onBeforeWrite).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Censor function
// ---------------------------------------------------------------------------

describe('@ligelog/redact — censor function', () => {
  it('applies custom censor string', async () => {
    const { records } = await logAndFlush(['password'], 'login', { password: 'secret' }, { censor: '***' });
    expect(records[0]?.password).toBe('***');
  });

  it('applies custom censor function with value and path', async () => {
    const { records } = await logAndFlush(
      ['email'],
      'signup',
      { email: 'alice@example.com' },
      {
        censor: (value, path) => {
          if (typeof value === 'string' && path === 'email') {
            return value.replace(/(.{2}).+(@.+)/, '$1***$2');
          }
          return '[REDACTED]';
        },
      }
    );

    expect(records[0]?.email).toBe('al***@example.com');
  });

  it('falls back to [CENSOR_ERROR] when censor function throws', async () => {
    const { records } = await logAndFlush(
      ['secret'],
      'fail',
      { secret: 'value' },
      {
        censor: () => {
          throw new Error('boom');
        },
      }
    );

    expect(records[0]?.secret).toBe('[CENSOR_ERROR]');
  });
});

// ---------------------------------------------------------------------------
// Wildcard matching
// ---------------------------------------------------------------------------

describe('@ligelog/redact — wildcard', () => {
  it('redacts all keys at a level with trailing *', async () => {
    const { records } = await logAndFlush(['headers.*'], 'req', {
      headers: { authorization: 'Bearer xxx', cookie: 'sid=123', host: 'example.com' },
    });

    const headers = records[0]?.headers as Record<string, unknown>;
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers.host).toBe('[REDACTED]');
  });

  it('redacts with intermediate wildcard', async () => {
    const { records } = await logAndFlush(['users.*.ssn'], 'batch', {
      users: {
        alice: { name: 'Alice', ssn: '111-22-3333' },
        bob: { name: 'Bob', ssn: '444-55-6666' },
      },
    });

    const users = records[0]?.users as Record<string, Record<string, unknown>>;
    expect(users.alice?.name).toBe('Alice');
    expect(users.alice?.ssn).toBe('[REDACTED]');
    expect(users.bob?.name).toBe('Bob');
    expect(users.bob?.ssn).toBe('[REDACTED]');
  });

  it('redacts top-level wildcard *.password', async () => {
    const { records } = await logAndFlush(['*.password'], 'multi', {
      db: { password: 'dbpass', host: 'localhost' },
      api: { password: 'apipass', url: 'https://api.test' },
    });

    const db = records[0]?.db as Record<string, unknown>;
    const api = records[0]?.api as Record<string, unknown>;
    expect(db.password).toBe('[REDACTED]');
    expect(db.host).toBe('localhost');
    expect(api.password).toBe('[REDACTED]');
    expect(api.url).toBe('https://api.test');
  });
});

// ---------------------------------------------------------------------------
// Remove mode
// ---------------------------------------------------------------------------

describe('@ligelog/redact — remove mode', () => {
  it('removes the key entirely when remove is true', async () => {
    const { records } = await logAndFlush(['secret'], 'rm', { secret: 'x', keep: 'y' }, { remove: true });

    expect('secret' in (records[0] ?? {})).toBe(false);
    expect(records[0]?.keep).toBe('y');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('@ligelog/redact — edge cases', () => {
  it('does nothing when path does not exist', async () => {
    const { records } = await logAndFlush(['nonexistent.deep.path'], 'ok', { data: 'hello' });
    expect(records[0]?.data).toBe('hello');
  });

  it('handles null value in nested path gracefully', async () => {
    const { records } = await logAndFlush(['user.password'], 'null', { user: null });
    // Should not throw, just pass through
    expect(records[0]?.user).toBeNull();
  });

  it('handles undefined value in nested path gracefully', async () => {
    const { records } = await logAndFlush(['user.password'], 'undef', {});
    expect(records).toHaveLength(1);
  });

  it('skips arrays in intermediate path (v1 limitation)', async () => {
    const { records } = await logAndFlush(['items.password'], 'arr', {
      items: [{ password: 'secret' }],
    });
    // Arrays are skipped — no crash, no redaction
    const items = records[0]?.items as unknown[];
    expect((items[0] as Record<string, unknown>).password).toBe('secret');
  });

  it('handles circular references without stack overflow', () => {
    const hooks = createRedactHook({ paths: ['a.b.c'] });
    const hook = hooks.onBeforeWrite![0]!;

    // Create a circular reference: obj.a.b = obj.a
    const inner: Record<string, unknown> = { value: 'keep' };
    inner.b = inner; // circular!
    const ctx = {
      record: { level: 30, lvl: 'info', time: Date.now(), msg: 'circ', pid: 1, a: inner },
    };

    // Should not throw (infinite recursion) — just return safely
    const result = hook(ctx as never);
    expect(result).toBeTruthy();
  });

  it('redacts shared object references at all locations', () => {
    const hooks = createRedactHook({ paths: ['*.secret'] });
    const hook = hooks.onBeforeWrite![0]!;

    // Same object referenced by two keys
    const shared = { secret: 'password', name: 'keep' };
    const ctx = {
      record: { level: 30, lvl: 'info', time: Date.now(), msg: 'shared', pid: 1, db: shared, api: shared },
    };

    const result = hook(ctx as never);
    const record = (result as { record: Record<string, unknown> }).record;
    const db = record.db as Record<string, unknown>;
    const api = record.api as Record<string, unknown>;

    // Both locations must be redacted
    expect(db.secret).toBe('[REDACTED]');
    expect(api.secret).toBe('[REDACTED]');
    // Non-redacted fields preserved
    expect(db.name).toBe('keep');
    expect(api.name).toBe('keep');
  });

  it('does not traverse prototype chain properties', () => {
    const hooks = createRedactHook({ paths: ['toString'] });
    const hook = hooks.onBeforeWrite![0]!;

    const ctx = {
      record: { level: 30, lvl: 'info', time: Date.now(), msg: 'proto', pid: 1 },
    };

    // toString exists on prototype but not as own property — should not be redacted
    const result = hook(ctx as never);
    // Should pass through unchanged (no own property 'toString')
    expect(result).toBe(ctx);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('@ligelog/redact — immutability', () => {
  it('does not mutate the original record', async () => {
    const mem = new MemoryTransport();
    const logger = createLogger({ transports: [mem] });

    const original = { password: 'secret', name: 'Alice' };
    const originalCopy = { ...original };

    logger.use(createRedactHook({ paths: ['password'] }));
    logger.info('immut', original);
    await logger.flush();

    // The fields we passed should remain unchanged
    expect(original.password).toBe(originalCopy.password);
    expect(original.name).toBe(originalCopy.name);
  });

  it('preserves unrelated nested references (COW)', async () => {
    const mem = new MemoryTransport();
    const logger = createLogger({ transports: [mem] });

    const nested = { keep: { deep: 'value' }, redact: { secret: 'x' } };
    logger.use(createRedactHook({ paths: ['redact.secret'] }));
    logger.info('cow', nested);
    await logger.flush();

    const result = mem.records[0] as Record<string, unknown>;
    const resultRedact = result.redact as Record<string, unknown>;
    expect(resultRedact.secret).toBe('[REDACTED]');

    // The unrelated nested object should keep same reference
    // (COW only clones along redaction path)
    expect(result.keep).toBe(nested.keep);
  });
});

// ---------------------------------------------------------------------------
// Integration with serializer
// ---------------------------------------------------------------------------

describe('@ligelog/redact — serializer integration', () => {
  it('serialized output does not contain redacted values', async () => {
    const { lines } = await logAndFlush(['password', 'token'], 'auth', {
      password: 'MyP@ssw0rd!',
      token: 'jwt.secret.token',
      username: 'alice',
    });

    expect(lines[0]).not.toContain('MyP@ssw0rd!');
    expect(lines[0]).not.toContain('jwt.secret.token');
    expect(lines[0]).toContain('alice');
    expect(lines[0]).toContain('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Performance sanity check
// ---------------------------------------------------------------------------

describe('@ligelog/redact — performance', () => {
  it('handles 10 redaction paths in reasonable time', async () => {
    const paths = Array.from({ length: 10 }, (_, i) => `field${i}`);
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      fields[`field${i}`] = `value${i}`;
    }

    const start = performance.now();
    const { records } = await logAndFlush(paths, 'perf', fields);
    const elapsed = performance.now() - start;

    expect(records).toHaveLength(1);
    for (let i = 0; i < 10; i++) {
      expect(records[0]?.[`field${i}`]).toBe('[REDACTED]');
    }
    // Should complete well within 100ms
    expect(elapsed).toBeLessThan(100);
  });
});
