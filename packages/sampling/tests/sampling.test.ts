/**
 * @file tests/sampling.test.ts
 * Tests for @ligelog/sampling hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSamplingHook } from '../src/index';
import type { HookContext, LevelName, LevelValue } from 'ligelog';
import { LEVELS } from 'ligelog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(lvl: LevelName = 'info', msg = 'test'): HookContext {
  return {
    record: {
      level: LEVELS[lvl] as LevelValue,
      lvl,
      time: Date.now(),
      msg,
      pid: 1,
    },
  };
}

function getHook(hooks: ReturnType<typeof createSamplingHook>) {
  const fn = hooks.onBeforeWrite?.[0];
  if (!fn) throw new Error('No onBeforeWrite hook found');
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSamplingHook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty hooks when rate is 1.0 (no-op)', () => {
    const hooks = createSamplingHook({ rate: 1.0 });
    expect(hooks.onBeforeWrite).toBeUndefined();
  });

  it('returns empty hooks with no options (default rate 1.0)', () => {
    const hooks = createSamplingHook();
    expect(hooks.onBeforeWrite).toBeUndefined();
  });

  it('drops all entries when rate is 0.0', () => {
    const hooks = createSamplingHook({ rate: 0.0, byLevel: {} });
    const hook = getHook(hooks);

    for (let i = 0; i < 10; i++) {
      expect(hook(makeCtx())).toBe(false);
    }
  });

  it('passes approximately half with rate 0.5 (counter strategy)', () => {
    const hooks = createSamplingHook({ rate: 0.5, byLevel: {} });
    const hook = getHook(hooks);

    let passed = 0;
    for (let i = 0; i < 100; i++) {
      if (hook(makeCtx()) !== false) passed++;
    }
    expect(passed).toBe(50);
  });

  it('passes 10 out of 100 with rate 0.1 (counter strategy)', () => {
    const hooks = createSamplingHook({ rate: 0.1, byLevel: {} });
    const hook = getHook(hooks);

    let passed = 0;
    for (let i = 0; i < 100; i++) {
      if (hook(makeCtx()) !== false) passed++;
    }
    expect(passed).toBe(10);
  });

  it('handles non-integer interval rates like 0.75 accurately', () => {
    const hooks = createSamplingHook({ rate: 0.75, byLevel: {} });
    const hook = getHook(hooks);

    let passed = 0;
    for (let i = 0; i < 100; i++) {
      if (hook(makeCtx()) !== false) passed++;
    }
    // 0.75 rate → 75 out of 100 should pass
    expect(passed).toBe(75);
  });

  it('handles rate 0.33 accurately over large sample', () => {
    const hooks = createSamplingHook({ rate: 0.33, byLevel: {} });
    const hook = getHook(hooks);

    let passed = 0;
    for (let i = 0; i < 300; i++) {
      if (hook(makeCtx()) !== false) passed++;
    }
    // 0.33 * 300 = 99
    expect(passed).toBe(99);
  });

  it('burst: first N entries pass regardless of rate', () => {
    const hooks = createSamplingHook({ rate: 0.0, burst: 3, byLevel: {} });
    const hook = getHook(hooks);

    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(hook(makeCtx()) !== false);
    }

    expect(results).toEqual([true, true, true, false, false, false]);
  });

  it('byLevel: error and fatal always pass by default', () => {
    const hooks = createSamplingHook({ rate: 0.0 });
    const hook = getHook(hooks);

    for (let i = 0; i < 10; i++) {
      expect(hook(makeCtx('error'))).not.toBe(false);
      expect(hook(makeCtx('fatal'))).not.toBe(false);
    }
    // But info should be dropped
    expect(hook(makeCtx('info'))).toBe(false);
  });

  it('byLevel: custom level overrides apply', () => {
    const hooks = createSamplingHook({
      rate: 0.0,
      byLevel: { debug: 1.0, error: 0.0, fatal: 0.0 },
    });
    const hook = getHook(hooks);

    // debug should pass (rate 1.0)
    expect(hook(makeCtx('debug'))).not.toBe(false);
    // error should be dropped (overridden to 0.0)
    expect(hook(makeCtx('error'))).toBe(false);
  });

  it('random strategy: passes approximately the expected ratio', () => {
    let callCount = 0;
    const originalRandom = Math.random;
    Math.random = () => {
      callCount++;
      // Alternate 0.05 and 0.95 → 50% pass for rate 0.5
      return callCount % 2 === 1 ? 0.05 : 0.95;
    };

    try {
      const hooks = createSamplingHook({ rate: 0.5, strategy: 'random', byLevel: {} });
      const hook = getHook(hooks);

      let passed = 0;
      for (let i = 0; i < 100; i++) {
        if (hook(makeCtx()) !== false) passed++;
      }
      expect(passed).toBe(50);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('windowMs: resets counter after window expires', () => {
    const hooks = createSamplingHook({
      rate: 0.0,
      burst: 2,
      windowMs: 1000,
      byLevel: {},
    });
    const hook = getHook(hooks);

    // First window: burst 2 pass
    expect(hook(makeCtx())).not.toBe(false);
    expect(hook(makeCtx())).not.toBe(false);
    expect(hook(makeCtx())).toBe(false);

    // Advance time past window
    vi.advanceTimersByTime(1001);

    // New window: burst resets
    expect(hook(makeCtx())).not.toBe(false);
    expect(hook(makeCtx())).not.toBe(false);
    expect(hook(makeCtx())).toBe(false);
  });

  it('reports dropped count on next passing entry (_sampledDropped)', () => {
    const hooks = createSamplingHook({ rate: 0.5, byLevel: {} });
    const hook = getHook(hooks);

    // Accumulator: entry 1 → acc=0.5 (drop), entry 2 → acc=1.0 (pass)
    const first = hook(makeCtx()); // drop
    expect(first).toBe(false);

    const second = hook(makeCtx()); // pass, _sampledDropped = 1
    expect(second).not.toBe(false);
    expect((second as HookContext).record._sampledDropped).toBe(1);
  });

  it('does not mutate the original record when adding _sampledDropped', () => {
    const hooks = createSamplingHook({ rate: 0.5, byLevel: {} });
    const hook = getHook(hooks);

    const ctx1 = makeCtx();
    const ctx2 = makeCtx();
    hook(ctx1); // drop
    hook(ctx2); // pass with _sampledDropped

    // Original records should not be mutated
    expect(ctx1.record._sampledDropped).toBeUndefined();
    expect(ctx2.record._sampledDropped).toBeUndefined();
  });

  it('clears dropped count after reporting', () => {
    const hooks = createSamplingHook({ rate: 0.5, byLevel: {} });
    const hook = getHook(hooks);

    // entry 1 → drop, entry 2 → pass with _sampledDropped=1
    hook(makeCtx());
    const second = hook(makeCtx());
    expect(second).not.toBe(false);
    expect((second as HookContext).record._sampledDropped).toBe(1);

    // entry 3 → drop, entry 4 → pass with _sampledDropped=1 (fresh count)
    hook(makeCtx());
    const fourth = hook(makeCtx());
    expect(fourth).not.toBe(false);
    expect((fourth as HookContext).record._sampledDropped).toBe(1);
  });

  it('counter strategy: per-level isolation (no cross-contamination)', () => {
    const hooks = createSamplingHook({
      rate: 0.5,
      byLevel: { debug: 0.1 },
    });
    const hook = getHook(hooks);

    // 10 info entries at rate 0.5 → 5 should pass
    let infoPassed = 0;
    for (let i = 0; i < 10; i++) {
      if (hook(makeCtx('info')) !== false) infoPassed++;
    }
    expect(infoPassed).toBe(5);

    // 10 debug entries at rate 0.1 → 1 should pass
    let debugPassed = 0;
    for (let i = 0; i < 10; i++) {
      if (hook(makeCtx('debug')) !== false) debugPassed++;
    }
    expect(debugPassed).toBe(1);
  });

  it('counter strategy: interleaved levels maintain correct rates', () => {
    const hooks = createSamplingHook({
      rate: 0.5,
      byLevel: { debug: 0.5 },
    });
    const hook = getHook(hooks);

    let infoPassed = 0;
    let debugPassed = 0;
    for (let i = 0; i < 100; i++) {
      if (hook(makeCtx('info')) !== false) infoPassed++;
      if (hook(makeCtx('debug')) !== false) debugPassed++;
    }
    expect(infoPassed).toBe(50);
    expect(debugPassed).toBe(50);
  });

  it('windowMs: resets per-level counters after window expires', () => {
    const hooks = createSamplingHook({
      rate: 0.5,
      windowMs: 1000,
      byLevel: {},
    });
    const hook = getHook(hooks);

    // First window: 10 entries → 5 pass
    let passed = 0;
    for (let i = 0; i < 10; i++) {
      if (hook(makeCtx()) !== false) passed++;
    }
    expect(passed).toBe(5);

    // Advance past window
    vi.advanceTimersByTime(1001);

    // New window: counters reset, 10 entries → 5 pass again
    passed = 0;
    for (let i = 0; i < 10; i++) {
      if (hook(makeCtx()) !== false) passed++;
    }
    expect(passed).toBe(5);
  });
});
