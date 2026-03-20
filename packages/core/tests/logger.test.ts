/**
 * @file tests/logger.test.ts
 * Integration tests for Logger, AsyncQueue, and hook pipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Logger }          from '../src/logger'
import { createLogger }    from '../src/index'
import type { Transport, LogRecord, Hooks } from '../src/types'

// ---------------------------------------------------------------------------
// In-memory transport for testing
// ---------------------------------------------------------------------------

class MemoryTransport implements Transport {
  readonly lines:   string[]   = []
  readonly records: LogRecord[] = []

  write(line: string, record: LogRecord): void {
    this.lines.push(line)
    this.records.push(record)
  }
}

async function flush(logger: Logger): Promise<void> {
  await logger.flush()
}

// ---------------------------------------------------------------------------
// Basic logging
// ---------------------------------------------------------------------------

describe('Logger — basic logging', () => {
  let mem: MemoryTransport
  let logger: Logger

  beforeEach(() => {
    mem    = new MemoryTransport()
    logger = createLogger({ level: 'debug', transports: [mem] })
  })

  it('emits all five log levels', async () => {
    logger.debug('d')
    logger.info ('i')
    logger.warn ('w')
    logger.error('e')
    logger.fatal('f')
    await flush(logger)

    const lvls = mem.records.map(r => r.lvl)
    expect(lvls).toEqual(['debug', 'info', 'warn', 'error', 'fatal'])
  })

  it('drops entries below minLevel', async () => {
    const l = createLogger({ level: 'warn', transports: [mem] })
    l.debug('nope')
    l.info ('nope')
    l.warn ('yes')
    await flush(l)

    expect(mem.records).toHaveLength(1)
    expect(mem.records[0].lvl).toBe('warn')
  })

  it('includes msg and time in every record', async () => {
    logger.info('hello world')
    await flush(logger)

    const r = mem.records[0]
    expect(r.msg).toBe('hello world')
    expect(typeof r.time).toBe('number')
  })

  it('merges extra fields into the record', async () => {
    logger.info('req', { requestId: 'x-1', statusCode: 200 })
    await flush(logger)

    const r = mem.records[0]
    expect(r.requestId).toBe('x-1')
    expect(r.statusCode).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// child()
// ---------------------------------------------------------------------------

describe('Logger — child()', () => {
  it('inherits parent context', async () => {
    const mem    = new MemoryTransport()
    const parent = createLogger({ context: { app: 'api' }, transports: [mem] })
    const child  = parent.child({ requestId: 'r-1' })

    child.info('child message')
    await child.flush()

    const r = mem.records[0]
    expect(r.app).toBe('api')
    expect(r.requestId).toBe('r-1')
  })

  it('child context overrides parent context', async () => {
    const mem    = new MemoryTransport()
    const parent = createLogger({ context: { env: 'prod' }, transports: [mem] })
    const child  = parent.child({ env: 'test' })

    child.info('msg')
    await child.flush()

    expect(mem.records[0].env).toBe('test')
  })

  it('child shares queue state with parent (dropped count)', () => {
    const mem    = new MemoryTransport()
    const parent = createLogger({ level: 'debug', transports: [mem] })
    const child  = parent.child({ scope: 'child' })

    for (let i = 0; i < 10000; i++) {
      child.debug('burst', { i })
    }

    expect(parent.getDropped()).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// use() / hooks
// ---------------------------------------------------------------------------

describe('Logger — use() and hooks', () => {
  it('onBeforeWrite can drop an entry', async () => {
    const mem    = new MemoryTransport()
    const logger = createLogger({ transports: [mem] })

    logger.use({
      onBeforeWrite: [ctx => (ctx.record.msg === 'drop me' ? false : ctx)],
    })

    logger.info('keep me')
    logger.info('drop me')
    await flush(logger)

    expect(mem.records).toHaveLength(1)
    expect(mem.records[0].msg).toBe('keep me')
  })

  it('onSerialize can replace the output string', async () => {
    const mem    = new MemoryTransport()
    const logger = createLogger({ transports: [mem] })

    logger.use({
      onSerialize: [ctx => ({ ...ctx, output: 'CUSTOM\n' })],
    })

    logger.info('anything')
    await flush(logger)

    expect(mem.lines[0]).toBe('CUSTOM\n')
  })

  it('onAfterWrite is called for side-effects', async () => {
    const mem    = new MemoryTransport()
    const logger = createLogger({ transports: [mem] })
    const spy    = vi.fn()

    logger.use({ onAfterWrite: [spy] })
    logger.info('side effect')
    await flush(logger)

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0].record.msg).toBe('side effect')
  })

  it('does not throw when onBeforeWrite hook throws', async () => {
    const mem    = new MemoryTransport()
    const logger = createLogger({ transports: [mem] })
    logger.use({
      onBeforeWrite: [() => { throw new Error('before hook failure') }],
    })

    expect(() => logger.info('safe')).not.toThrow()
    await flush(logger)
    expect(mem.records).toHaveLength(0)
  })

  it('falls back to default serializer when onSerialize hook throws', async () => {
    const mem    = new MemoryTransport()
    const logger = createLogger({ transports: [mem] })
    logger.use({
      onSerialize: [() => { throw new Error('serialize hook failure') }],
    })

    logger.info('safe serialize fallback')
    await flush(logger)
    expect(mem.records).toHaveLength(1)
    expect(mem.records[0].msg).toBe('safe serialize fallback')
  })

  it('does not throw when onAfterWrite hook throws', async () => {
    const mem    = new MemoryTransport()
    const logger = createLogger({ transports: [mem] })
    logger.use({
      onAfterWrite: [() => { throw new Error('after hook failure') }],
    })

    expect(() => logger.info('safe after')).not.toThrow()
    await flush(logger)
    expect(mem.records).toHaveLength(1)
  })

  it('use() is chainable', () => {
    const logger = createLogger()
    const result = logger.use({}).use({})
    expect(result).toBe(logger)
  })

  it('flush() also flushes transports that implement flush()', async () => {
    const flushSpy = vi.fn(async () => {})
    const transport: Transport = {
      write: () => {},
      flush: flushSpy,
    }
    const logger = createLogger({ transports: [transport] })
    logger.info('hello')
    await logger.flush()
    expect(flushSpy).toHaveBeenCalledOnce()
  })

  it('close() flushes and closes transports', async () => {
    const flushSpy = vi.fn(async () => {})
    const closeSpy = vi.fn(async () => {})
    const transport: Transport = {
      write: () => {},
      flush: flushSpy,
      close: closeSpy,
    }
    const logger = createLogger({ transports: [transport] })
    logger.info('bye')
    await logger.close()
    expect(flushSpy).toHaveBeenCalledOnce()
    expect(closeSpy).toHaveBeenCalledOnce()
  })

  it('getWriteErrors() reports transport write failures', async () => {
    const transport: Transport = {
      write: () => { throw new Error('boom') },
    }
    const logger = createLogger({ transports: [transport] })
    logger.info('a')
    logger.info('b')
    await logger.flush()
    expect(logger.getWriteErrors()).toBe(2)
  })
})
