/**
 * @file tests/serializer.test.ts
 * Unit tests for the custom NDJSON serializer.
 */

import { describe, it, expect } from 'vitest'
import { serialize, encodeValue } from '../src/serializer'
import type { LogRecord } from '../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 20,
    lvl:   'info',
    time:  1700000000000,
    msg:   'test message',
    pid:   1234,
    ...overrides,
  }
}

function parse(record: LogRecord): Record<string, unknown> {
  const line = serialize(record)
  expect(line.endsWith('\n')).toBe(true)
  return JSON.parse(line.trimEnd())
}

// ---------------------------------------------------------------------------
// encodeValue
// ---------------------------------------------------------------------------

describe('encodeValue', () => {
  it('encodes null and undefined as null', () => {
    expect(encodeValue(null)).toBe('null')
    expect(encodeValue(undefined)).toBe('null')
  })

  it('encodes booleans', () => {
    expect(encodeValue(true)).toBe('true')
    expect(encodeValue(false)).toBe('false')
  })

  it('encodes finite numbers', () => {
    expect(encodeValue(42)).toBe('42')
    expect(encodeValue(-3.14)).toBe('-3.14')
  })

  it('encodes non-finite numbers as null', () => {
    expect(encodeValue(Infinity)).toBe('null')
    expect(encodeValue(-Infinity)).toBe('null')
    expect(encodeValue(NaN)).toBe('null')
  })

  it('encodes bigint as a JSON string', () => {
    expect(encodeValue(123n)).toBe('"123"')
  })

  it('encodes Date as an ISO string', () => {
    const d = new Date('2024-01-01T00:00:00.000Z')
    expect(encodeValue(d)).toBe('"2024-01-01T00:00:00.000Z"')
  })

  it('encodes strings with proper escaping', () => {
    expect(encodeValue('hello')).toBe('"hello"')
    expect(encodeValue('say "hi"')).toBe('"say \\"hi\\""')
    expect(encodeValue('line1\nline2')).toBe('"line1\\nline2"')
    expect(encodeValue('tab\there')).toBe('"tab\\there"')
  })

  it('encodes control characters as \\uXXXX', () => {
    expect(encodeValue('\x00')).toBe('"\\u0000"')
    expect(encodeValue('\x1f')).toBe('"\\u001f"')
  })

  it('escapes U+2028 and U+2029 for parser compatibility', () => {
    expect(encodeValue('\u2028')).toBe('"\\u2028"')
    expect(encodeValue('\u2029')).toBe('"\\u2029"')
  })

  it('encodes nested objects', () => {
    const result = JSON.parse(encodeValue({ a: 1, b: 'x' }) as string)
    expect(result).toEqual({ a: 1, b: 'x' })
  })

  it('encodes arrays', () => {
    expect(JSON.parse(encodeValue([1, 'two', null]) as string)).toEqual([1, 'two', null])
  })

  it('encodes Error objects with name, message, stack', () => {
    const err    = new Error('oops')
    const result = JSON.parse(encodeValue(err) as string)
    expect(result.name).toBe('Error')
    expect(result.message).toBe('oops')
    expect(typeof result.stack).toBe('string')
  })

  it('preserves enumerable custom Error properties', () => {
    const err = new Error('oops') as Error & { code?: string; status?: number }
    err.code = 'E_FAIL'
    err.status = 500
    const result = JSON.parse(encodeValue(err) as string)
    expect(result.code).toBe('E_FAIL')
    expect(result.status).toBe(500)
  })

  it('guards circular references', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    const result = JSON.parse(encodeValue(a) as string)
    expect(result.self).toBe('[Circular]')
  })

  it('guards very deep objects with max-depth marker', () => {
    const root: Record<string, unknown> = {}
    let node: Record<string, unknown> = root
    for (let i = 0; i < 20; i++) {
      node.next = {}
      node = node.next as Record<string, unknown>
    }
    const result = JSON.parse(encodeValue(root) as string)
    let cur: any = result
    let markerFound = false
    for (let i = 0; i < 20; i++) {
      if (cur === '[MaxDepth]') {
        markerFound = true
        break
      }
      cur = cur?.next
    }
    expect(markerFound).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

describe('serialize', () => {
  it('produces valid JSON terminated by a newline', () => {
    const line = serialize(makeRecord())
    expect(() => JSON.parse(line.trimEnd())).not.toThrow()
    expect(line.endsWith('\n')).toBe(true)
  })

  it('includes all fixed fields', () => {
    const out = parse(makeRecord())
    expect(out).toMatchObject({
      level: 20,
      lvl:   'info',
      time:  1700000000000,
      msg:   'test message',
      pid:   1234,
    })
  })

  it('includes an ISO-8601 timestamp in the iso field', () => {
    const out = parse(makeRecord())
    expect(typeof out.iso).toBe('string')
    expect((out.iso as string)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('spreads extra context fields into the output', () => {
    const out = parse(makeRecord({ requestId: 'abc-123', userId: 42 } as any))
    expect(out.requestId).toBe('abc-123')
    expect(out.userId).toBe(42)
  })

  it('serializes Error objects in context', () => {
    const err = new Error('db timeout')
    const out = parse(makeRecord({ error: err } as any))
    expect((out.error as any).message).toBe('db timeout')
  })
})
