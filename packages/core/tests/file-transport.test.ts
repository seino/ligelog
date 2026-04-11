/**
 * @file tests/file-transport.test.ts
 * Unit tests for FileTransport lifecycle behavior.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTransport } from '../src/transports/file';

function tempPath(name: string): string {
  const dir = join(tmpdir(), 'ligelog-tests');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`);
}

describe('FileTransport', () => {
  it('creates parent directories on construction', () => {
    const base = join(tmpdir(), 'ligelog-tests', `nested-${Date.now()}`);
    const path = join(base, 'a', 'b', 'app.log');
    const t = new FileTransport({ path });
    expect(existsSync(join(base, 'a', 'b'))).toBe(true);
    return t.close();
  });

  it('flush resolves quickly when no drain is needed', async () => {
    const path = tempPath('flush-no-drain');
    const t = new FileTransport({ path });
    const result = await Promise.race([
      t.flush().then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ]);
    expect(result).toBe('resolved');
    await t.close();
    rmSync(path, { force: true });
  });

  it('writes log lines that can be read back', async () => {
    const path = tempPath('write-readback');
    const t = new FileTransport({ path });

    t.write('line1\n', { level: 20, lvl: 'info', time: Date.now(), msg: 'a', pid: 1 });
    t.write('line2\n', { level: 20, lvl: 'info', time: Date.now(), msg: 'b', pid: 1 });
    await t.flush();
    await t.close();

    const content = readFileSync(path, 'utf8');
    expect(content).toBe('line1\nline2\n');
    rmSync(path, { force: true });
  });

  it('close resolves after all writes are flushed', async () => {
    const path = tempPath('close-after-writes');
    const t = new FileTransport({ path });

    for (let i = 0; i < 100; i++) {
      t.write(`line-${i}\n`, { level: 20, lvl: 'info', time: Date.now(), msg: `m${i}`, pid: 1 });
    }

    await t.close();
    const content = readFileSync(path, 'utf8');
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(100);
    rmSync(path, { force: true });
  });
});
