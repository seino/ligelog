/**
 * @file tests/context.test.ts
 * Tests for @ligelog/context hook.
 */

import { describe, it, expect } from 'vitest';
import { createContextStore, createContextHook } from '../src/index';
import type { HookContext, LevelValue } from 'ligelog';
import { LEVELS } from 'ligelog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(msg = 'test', extra: Record<string, unknown> = {}): HookContext {
  return {
    record: {
      level: LEVELS.info as LevelValue,
      lvl: 'info',
      time: Date.now(),
      msg,
      pid: 1,
      ...extra,
    },
  };
}

function getHook(hooks: ReturnType<typeof createContextHook>) {
  const fn = hooks.onBeforeWrite?.[0];
  if (!fn) throw new Error('No onBeforeWrite hook found');
  return fn;
}

// ---------------------------------------------------------------------------
// ContextStore tests
// ---------------------------------------------------------------------------

describe('createContextStore', () => {
  it('returns empty object outside run()', () => {
    const store = createContextStore();
    expect(store.get()).toEqual({});
  });

  it('provides fields within run()', () => {
    const store = createContextStore();
    store.run({ requestId: 'abc' }, () => {
      expect(store.get()).toEqual({ requestId: 'abc' });
    });
  });

  it('restores parent context after run() completes', () => {
    const store = createContextStore();
    store.run({ requestId: 'abc' }, () => {
      // Inside scope
      expect(store.get()).toEqual({ requestId: 'abc' });
    });
    // Outside scope
    expect(store.get()).toEqual({});
  });

  it('supports nested run() — inner overrides outer', () => {
    const store = createContextStore();
    store.run({ requestId: 'outer', userId: 1 }, () => {
      expect(store.get()).toEqual({ requestId: 'outer', userId: 1 });

      store.run({ requestId: 'inner', traceId: 'xyz' }, () => {
        expect(store.get()).toEqual({
          requestId: 'inner',
          userId: 1,
          traceId: 'xyz',
        });
      });

      // After inner run, outer context is restored
      expect(store.get()).toEqual({ requestId: 'outer', userId: 1 });
    });
  });

  it('set() adds fields to current context', () => {
    const store = createContextStore();
    store.run({ requestId: 'abc' }, () => {
      store.set({ userId: 42 });
      expect(store.get()).toEqual({ requestId: 'abc', userId: 42 });
    });
  });

  it('set() is no-op outside run()', () => {
    const store = createContextStore();
    store.set({ userId: 42 });
    expect(store.get()).toEqual({});
  });

  it('preserves context across async boundaries', async () => {
    const store = createContextStore();

    const result = await store.run({ requestId: 'async-test' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return store.get();
    });

    expect(result).toEqual({ requestId: 'async-test' });
  });

  it('isolates context between concurrent runs', async () => {
    const store = createContextStore();

    const results = await Promise.all([
      store.run({ id: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return store.get();
      }),
      store.run({ id: 'b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return store.get();
      }),
    ]);

    expect(results[0]).toEqual({ id: 'a' });
    expect(results[1]).toEqual({ id: 'b' });
  });
});

// ---------------------------------------------------------------------------
// createContextHook tests
// ---------------------------------------------------------------------------

describe('createContextHook', () => {
  it('injects context fields into log record', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    store.run({ requestId: 'req-1', userId: 42 }, () => {
      const result = hook(makeCtx('hello'));
      expect(result).not.toBe(false);
      const record = (result as HookContext).record;
      expect(record.requestId).toBe('req-1');
      expect(record.userId).toBe(42);
      expect(record.msg).toBe('hello');
    });
  });

  it('passes through unchanged when no context is set', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    const ctx = makeCtx('no context');
    const result = hook(ctx);
    // Should return the same object (no unnecessary clone)
    expect(result).toBe(ctx);
  });

  it('explicit record fields override context fields', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    store.run({ requestId: 'from-context', extra: 'ctx-only' }, () => {
      const ctx = makeCtx('test', { requestId: 'explicit' });
      const result = hook(ctx);
      const record = (result as HookContext).record;
      // Explicit wins
      expect(record.requestId).toBe('explicit');
      // Context-only field is still injected
      expect(record.extra).toBe('ctx-only');
    });
  });

  it('does not mutate the original record', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    store.run({ requestId: 'abc' }, () => {
      const ctx = makeCtx('immutable test');
      const original = { ...ctx.record };
      hook(ctx);
      // Original ctx.record should not have requestId
      expect(ctx.record).toEqual(original);
    });
  });

  it('works with logger.child() pattern (context + child fields)', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    store.run({ traceId: 'trace-1' }, () => {
      // Simulate child logger adding its own fields to record
      const ctx = makeCtx('child test', { component: 'auth' });
      const result = hook(ctx);
      const record = (result as HookContext).record;
      expect(record.traceId).toBe('trace-1');
      expect(record.component).toBe('auth');
    });
  });

  it('ignores reserved LogRecord keys from context', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    store.run({ level: 999, lvl: 'fake', time: 0, msg: 'overridden', pid: -1, requestId: 'req-1' }, () => {
      const ctx = makeCtx('reserved test');
      const result = hook(ctx);
      const record = (result as HookContext).record;
      // Reserved keys should NOT be overridden by context
      expect(record.lvl).toBe('info');
      expect(record.msg).toBe('reserved test');
      expect(record.pid).toBe(1);
      // Non-reserved key should be injected
      expect(record.requestId).toBe('req-1');
    });
  });

  it('passes through unchanged when context has only reserved keys', () => {
    const store = createContextStore();
    const hooks = createContextHook(store);
    const hook = getHook(hooks);

    store.run({ level: 999, msg: 'bad' }, () => {
      const ctx = makeCtx('only reserved');
      const result = hook(ctx);
      // Should return same reference (no unnecessary clone)
      expect(result).toBe(ctx);
    });
  });
});
