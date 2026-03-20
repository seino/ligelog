/**
 * @file tests/file-transport.test.ts
 * Unit tests for FileTransport lifecycle behavior.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileTransport } from '../src/transports/file'

function tempPath(name: string): string {
  const dir = join(tmpdir(), 'ligelog-tests')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`)
}

describe('FileTransport', () => {
  it('creates parent directories on construction', () => {
    const base = join(tmpdir(), 'ligelog-tests', `nested-${Date.now()}`)
    const path = join(base, 'a', 'b', 'app.log')
    const t = new FileTransport({ path })
    expect(existsSync(join(base, 'a', 'b'))).toBe(true)
    return t.close()
  })

  it('flush resolves quickly when no drain is needed', async () => {
    const path = tempPath('flush-no-drain')
    const t = new FileTransport({ path })
    const result = await Promise.race([
      t.flush().then(() => 'resolved'),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 200)),
    ])
    expect(result).toBe('resolved')
    await t.close()
    rmSync(path, { force: true })
  })
})
