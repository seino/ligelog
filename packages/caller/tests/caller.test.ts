/**
 * @file tests/caller.test.ts
 * Tests for the caller hook.
 */

import { describe, it, expect } from 'vitest';
import { createCallerHook } from '../src/index';
import { runHooks } from 'ligelog/hooks';
import type { LogRecord, HookContext } from 'ligelog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<LogRecord> = {}): HookContext {
  return {
    record: {
      level: 20,
      lvl: 'info',
      time: Date.now(),
      msg: 'test message',
      pid: 1,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCallerHook', () => {
  it('adds caller_file, caller_line, and caller_fn to the record', () => {
    const hooks = createCallerHook();
    const ctx = makeCtx();
    const result = runHooks(hooks, ctx);

    expect(result).not.toBeNull();
    expect(result!.record.caller_file).toBeTypeOf('string');
    expect(result!.record.caller_file).toContain('caller.test.ts');
    expect(result!.record.caller_line).toBeTypeOf('number');
    expect(result!.record.caller_line).toBeGreaterThan(0);
    expect(result!.record.caller_fn).toBeTypeOf('string');
  });

  it('skips records below minLevel', () => {
    const hooks = createCallerHook({ minLevel: 'error' });
    const ctx = makeCtx({ level: 20, lvl: 'info' });
    const result = runHooks(hooks, ctx);

    expect(result).not.toBeNull();
    expect(result!.record.caller_file).toBeUndefined();
  });

  it('attaches caller info when record meets minLevel', () => {
    const hooks = createCallerHook({ minLevel: 'error' });
    const ctx = makeCtx({ level: 40, lvl: 'error' });
    const result = runHooks(hooks, ctx);

    expect(result).not.toBeNull();
    expect(result!.record.caller_file).toContain('caller.test.ts');
  });

  it('uses basename pathStyle by default', () => {
    const hooks = createCallerHook();
    const ctx = makeCtx();
    const result = runHooks(hooks, ctx);

    // basename should not contain directory separators
    const file = result!.record.caller_file as string;
    expect(file).not.toContain('/');
  });

  it('uses full pathStyle when specified', () => {
    const hooks = createCallerHook({ pathStyle: 'full' });
    const ctx = makeCtx();
    const result = runHooks(hooks, ctx);

    const file = result!.record.caller_file as string;
    expect(file).toContain('/');
  });

  it('uses relative pathStyle when specified', () => {
    const hooks = createCallerHook({ pathStyle: 'relative' });
    const ctx = makeCtx();
    const result = runHooks(hooks, ctx);

    const file = result!.record.caller_file as string;
    // Should not start with / (relative path)
    expect(file.startsWith('/')).toBe(false);
    expect(file).toContain('caller.test.ts');
  });

  it('works with child logger pattern (shared hooks)', () => {
    const hooks = createCallerHook();

    // Simulate calling from a wrapper function
    function logViaWrapper() {
      return runHooks(hooks, makeCtx());
    }

    const result = logViaWrapper();
    expect(result).not.toBeNull();
    expect(result!.record.caller_file).toBeTypeOf('string');
    expect(result!.record.caller_line).toBeGreaterThan(0);
  });
});
