/**
 * @file tests/hooks.test.ts
 * Tests for the Sentry hook integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSentryHook } from '../src/transports/sentry'
import { runHooks }         from '../src/hooks'
import type { LogRecord, HookContext } from '../src/types'

// ---------------------------------------------------------------------------
// Mock Sentry SDK
// ---------------------------------------------------------------------------

function makeSentry() {
  return {
    captureException: vi.fn(),
    captureMessage:   vi.fn(),
    addBreadcrumb:    vi.fn(),
  }
}

function makeCtx(overrides: Partial<LogRecord> = {}): HookContext {
  return {
    record: {
      level: 30,
      lvl:   'warn',
      time:  Date.now(),
      msg:   'something happened',
      pid:   1,
      ...overrides,
    },
  }
}

// ---------------------------------------------------------------------------
// createSentryHook
// ---------------------------------------------------------------------------

describe('createSentryHook', () => {
  it('calls captureMessage for warn entries', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry, minLevel: 'warn' })
    runHooks(hooks, makeCtx())

    expect(sentry.captureMessage).toHaveBeenCalledOnce()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('calls captureException when an Error is present in error records', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry })
    const err    = new Error('db timeout')

    runHooks(hooks, makeCtx({ level: 40, lvl: 'error', error: err } as any))

    expect(sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ extra: expect.objectContaining({ msg: 'something happened' }) }),
    )
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('falls back to captureMessage when no Error is present on error records', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry })

    runHooks(hooks, makeCtx({ level: 40, lvl: 'error' }))

    expect(sentry.captureMessage).toHaveBeenCalledOnce()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('adds breadcrumbs by default', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry })

    runHooks(hooks, makeCtx())

    expect(sentry.addBreadcrumb).toHaveBeenCalledOnce()
  })

  it('skips breadcrumbs when breadcrumbs: false', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry, breadcrumbs: false })

    runHooks(hooks, makeCtx())

    expect(sentry.addBreadcrumb).not.toHaveBeenCalled()
  })

  it('ignores entries below minLevel', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry, minLevel: 'error' })

    // warn (30) < error (40) — should be ignored
    runHooks(hooks, makeCtx({ level: 30, lvl: 'warn' }))

    expect(sentry.captureMessage).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled()
  })

  it('respects captureErrors: false', () => {
    const sentry = makeSentry()
    const hooks  = createSentryHook({ sentry, captureErrors: false })
    const err    = new Error('boom')

    runHooks(hooks, makeCtx({ level: 40, lvl: 'error', error: err } as any))

    // Must use captureMessage even though an Error is present
    expect(sentry.captureMessage).toHaveBeenCalledOnce()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })
})
