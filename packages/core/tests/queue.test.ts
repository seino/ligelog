/**
 * @file tests/queue.test.ts
 * Unit tests for AsyncQueue back-pressure and drain behavior.
 */

import { describe, it, expect, vi } from 'vitest'
import { AsyncQueue } from '../src/queue'
import type { LogRecord, Transport } from '../src/types'

function makeRecord(i = 0): LogRecord {
  return {
    level: 20,
    lvl: 'info',
    time: Date.now(),
    msg: `msg-${i}`,
    pid: 1,
    i,
  }
}

class CountingTransport implements Transport {
  writes = 0
  write(): void {
    this.writes++
  }
}

class ThrowingTransport implements Transport {
  write(): void {
    throw new Error('transport failure')
  }
}

describe('AsyncQueue', () => {
  it('drains queued entries to transport', async () => {
    const t = new CountingTransport()
    const q = new AsyncQueue([t])
    q.enqueue('{"msg":"a"}\n', makeRecord(1))
    q.enqueue('{"msg":"b"}\n', makeRecord(2))
    await q.drain()
    expect(t.writes).toBe(2)
  })

  it('counts dropped entries under sustained pressure', async () => {
    const t = new CountingTransport()
    const q = new AsyncQueue([t], 8)
    for (let i = 0; i < 20000; i++) {
      q.enqueue(`{"i":${i}}\n`, makeRecord(i))
    }
    await q.drain()
    expect(q.getDropped()).toBeGreaterThan(0)
  })

  it('validates queue size as power of two', () => {
    expect(() => new AsyncQueue([], 3)).toThrow()
    expect(() => new AsyncQueue([], 1)).toThrow()
    expect(() => new AsyncQueue([], 8)).not.toThrow()
  })

  it('isolates transport write errors and continues draining', async () => {
    const ok = new CountingTransport()
    const bad = new ThrowingTransport()
    const q = new AsyncQueue([bad, ok], 8)
    q.enqueue('{"msg":"a"}\n', makeRecord(1))
    q.enqueue('{"msg":"b"}\n', makeRecord(2))
    await q.drain()
    expect(ok.writes).toBe(2)
    expect(q.getWriteErrors()).toBe(2)
  })

  it('delivers entries in FIFO order', async () => {
    const received: number[] = []
    const transport: Transport = {
      write: (_line: string, record: LogRecord) => {
        received.push(record.i as number)
      },
    }
    const q = new AsyncQueue([transport])

    for (let i = 0; i < 100; i++) {
      q.enqueue(`{"i":${i}}\n`, makeRecord(i))
    }
    await q.drain()

    for (let i = 0; i < 100; i++) {
      expect(received[i]).toBe(i)
    }
  })

  it('delivers to multiple transports in registration order', async () => {
    const order: string[] = []
    const t1: Transport = { write: () => { order.push('t1') } }
    const t2: Transport = { write: () => { order.push('t2') } }
    const q = new AsyncQueue([t1, t2])

    q.enqueue('{"msg":"a"}\n', makeRecord(1))
    await q.drain()

    expect(order).toEqual(['t1', 't2'])
  })

  it('drain resolves immediately when queue is empty', async () => {
    const t = new CountingTransport()
    const q = new AsyncQueue([t])

    const result = await Promise.race([
      q.drain().then(() => 'resolved'),
      new Promise<string>((r) => setTimeout(() => r('timeout'), 100)),
    ])
    expect(result).toBe('resolved')
  })

  it('calls onDrop callback when entries are dropped', async () => {
    const t = new CountingTransport()
    const onDrop = vi.fn()
    const q = new AsyncQueue([t], 4, onDrop)

    for (let i = 0; i < 20; i++) {
      q.enqueue(`{"i":${i}}\n`, makeRecord(i))
    }
    await q.drain()

    expect(onDrop).toHaveBeenCalled()
    const lastCall = onDrop.mock.calls[onDrop.mock.calls.length - 1]
    expect(lastCall?.[0]).toBe(q.getDropped())
  })

  it('does not call onDrop when queue has capacity', async () => {
    const t = new CountingTransport()
    const onDrop = vi.fn()
    const q = new AsyncQueue([t], 8192, onDrop)

    q.enqueue('{"msg":"a"}\n', makeRecord(1))
    q.enqueue('{"msg":"b"}\n', makeRecord(2))
    await q.drain()

    expect(onDrop).not.toHaveBeenCalled()
  })
})
