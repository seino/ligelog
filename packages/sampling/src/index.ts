/**
 * @file index.ts
 * Log sampling hook for ligelog.
 *
 * Reduces log volume with deterministic (counter) or probabilistic (random)
 * sampling, inspired by Go zap/zerolog sampling.
 *
 * ## Setup
 *
 * ```ts
 * import { createLogger } from 'ligelog';
 * import { createSamplingHook } from '@ligelog/sampling';
 *
 * const logger = createLogger();
 * logger.use(createSamplingHook({ rate: 0.1 })); // 10% of logs pass through
 * ```
 *
 * @packageDocumentation
 */

import type { Hooks, HookContext, LevelName } from 'ligelog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options accepted by `createSamplingHook`. */
export interface SamplingOptions {
  /**
   * Global sampling rate. `1.0` = all pass, `0.1` = 10% pass, `0.0` = all drop.
   * @default 1.0
   */
  rate?: number;

  /**
   * Initial burst allowance. The first N entries in each window pass
   * regardless of `rate`.
   * @default 0
   */
  burst?: number;

  /**
   * Per-level rate overrides. Entries at specified levels use the given rate
   * instead of the global `rate`.
   *
   * By default, `error` and `fatal` always pass (`1.0`).
   *
   * @example { debug: 0.01, error: 1.0, fatal: 1.0 }
   */
  byLevel?: Partial<Record<LevelName, number>>;

  /**
   * Sampling window duration in milliseconds.
   * Counter and burst are reset at the start of each window.
   * @default 1000
   */
  windowMs?: number;

  /**
   * Sampling strategy.
   * - `'counter'` — deterministic: every `1/rate`-th entry passes.
   *   Easier to reproduce and debug.
   * - `'random'` — probabilistic: `Math.random() < rate`.
   *   More even distribution but not reproducible.
   * @default 'counter'
   */
  strategy?: 'counter' | 'random';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_RATE = 1.0;
const DEFAULT_BURST = 0;
const DEFAULT_WINDOW_MS = 1000;
const DEFAULT_STRATEGY: 'counter' | 'random' = 'counter';
const DEFAULT_BY_LEVEL: Partial<Record<LevelName, number>> = {
  error: 1.0,
  fatal: 1.0,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ligelog hook that samples log entries to reduce volume.
 *
 * Runs as an `onBeforeWrite` hook. Dropped entries are counted and the
 * total is attached as `_sampledDropped` on the next passing entry
 * (zap-style reporting).
 *
 * @param opts - Sampling configuration.
 * @returns A `Hooks` object ready for `logger.use()`.
 *
 * @example
 * ```ts
 * // 10% sampling with counter strategy
 * logger.use(createSamplingHook({ rate: 0.1 }));
 *
 * // Burst first 5, then 20% sampling, error/fatal always pass
 * logger.use(createSamplingHook({
 *   rate: 0.2,
 *   burst: 5,
 *   byLevel: { error: 1.0, fatal: 1.0, debug: 0.01 },
 * }));
 * ```
 */
export function createSamplingHook(opts: SamplingOptions = {}): Hooks {
  const {
    rate = DEFAULT_RATE,
    burst = DEFAULT_BURST,
    byLevel = DEFAULT_BY_LEVEL,
    windowMs = DEFAULT_WINDOW_MS,
    strategy = DEFAULT_STRATEGY,
  } = opts;

  // rate 1.0 means everything passes — no-op hook
  if (rate >= 1.0 && Object.values(byLevel).every((v) => v === undefined || v >= 1.0)) {
    return {};
  }

  // Merge default byLevel overrides
  const levelRates: Partial<Record<LevelName, number>> = {
    ...DEFAULT_BY_LEVEL,
    ...byLevel,
  };

  // Mutable state
  let windowStart = Date.now();
  let burstRemaining = burst;
  let droppedCount = 0;
  // Per-level integer counters for deterministic sampling.
  // Each level tracks its own seen/passed independently to avoid
  // cross-contamination when levels have different rates.
  const levelCounters = new Map<string, { seen: number; passed: number }>();

  function resetWindow(): void {
    windowStart = Date.now();
    levelCounters.clear();
    burstRemaining = burst;
  }

  function shouldPass(levelRate: number, levelName: string): boolean {
    // Burst: first N entries always pass
    if (burstRemaining > 0) {
      burstRemaining--;
      return true;
    }

    if (levelRate >= 1.0) return true;
    if (levelRate <= 0.0) return false;

    if (strategy === 'random') {
      return Math.random() < levelRate;
    }

    // Counter strategy: integer-based deterministic sampling.
    // Uses floor(seen * rate) to compute how many should have passed
    // by now, then passes if we're behind that target. This gives exact
    // throughput for any rate without floating-point drift.
    let counters = levelCounters.get(levelName);
    if (!counters) {
      counters = { seen: 0, passed: 0 };
      levelCounters.set(levelName, counters);
    }
    counters.seen++;
    const expected = Math.floor(counters.seen * levelRate);
    if (expected > counters.passed) {
      counters.passed++;
      return true;
    }
    return false;
  }

  return {
    onBeforeWrite: [
      (ctx: HookContext): HookContext | false => {
        const now = Date.now();

        // Check window expiry
        if (now - windowStart >= windowMs) {
          resetWindow();
        }

        const levelName = ctx.record.lvl;
        const levelRate = levelRates[levelName] ?? rate;

        if (shouldPass(levelRate, levelName)) {
          // Attach dropped count to passing entry (zap-style)
          if (droppedCount > 0) {
            const newRecord = { ...ctx.record, _sampledDropped: droppedCount };
            droppedCount = 0;
            return { ...ctx, record: newRecord };
          }
          return ctx;
        }

        // Drop this entry
        droppedCount++;
        return false;
      },
    ],
  };
}
