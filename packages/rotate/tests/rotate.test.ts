/**
 * @file tests/rotate.test.ts
 * Tests for RotateTransport.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { RotateTransport, parseSizeSpec } from '../src/index';
import { mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { LogRecord } from 'ligelog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 20,
    lvl: 'info',
    time: Date.now(),
    msg: 'test',
    pid: 1,
    ...overrides,
  };
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ligelog-rotate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// parseSizeSpec
// ---------------------------------------------------------------------------

describe('parseSizeSpec', () => {
  it('parses plain number as bytes', () => {
    expect(parseSizeSpec(1024)).toBe(1024);
  });

  it('parses B suffix', () => {
    expect(parseSizeSpec('100B')).toBe(100);
  });

  it('parses KB suffix', () => {
    expect(parseSizeSpec('10KB')).toBe(10 * 1024);
  });

  it('parses MB suffix', () => {
    expect(parseSizeSpec('5MB')).toBe(5 * 1024 * 1024);
  });

  it('parses GB suffix', () => {
    expect(parseSizeSpec('1GB')).toBe(1024 * 1024 * 1024);
  });

  it('throws on invalid spec', () => {
    expect(() => parseSizeSpec('10TB' as any)).toThrow('Invalid size spec');
  });
});

// ---------------------------------------------------------------------------
// RotateTransport
// ---------------------------------------------------------------------------

describe('RotateTransport', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) cleanupDir(d);
    dirs.length = 0;
  });

  it('writes log lines to the file', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({ path: logPath });
    transport.write('line1\n', makeRecord());
    transport.write('line2\n', makeRecord());
    await transport.close();

    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('line1\nline2\n');
  });

  it('rotates when maxSize is exceeded', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({
      path: logPath,
      maxSize: '50B',
      namingScheme: 'numeric',
    });

    // Write enough to trigger rotation (each line > 50 bytes threshold)
    const longLine = 'A'.repeat(30) + '\n';
    transport.write(longLine, makeRecord()); // 31 bytes
    transport.write(longLine, makeRecord()); // 62 bytes total -> triggers rotation on next write
    transport.write(longLine, makeRecord()); // written to new file after rotation

    await transport.close();

    const files = readdirSync(dir).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files).toContain('app.log');
  });

  it('respects maxFiles and deletes oldest rotated files', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({
      path: logPath,
      maxSize: '20B',
      maxFiles: 2,
      namingScheme: 'numeric',
    });

    // Write enough lines to trigger multiple rotations
    const line = 'A'.repeat(25) + '\n';
    for (let i = 0; i < 8; i++) {
      transport.write(line, makeRecord());
    }

    await transport.close();

    const files = readdirSync(dir);
    // app.log + at most 2 rotated files
    const rotated = files.filter((f) => f !== 'app.log');
    expect(rotated.length).toBeLessThanOrEqual(2);
  });

  it('rotates on time interval boundary', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({
      path: logPath,
      rotateInterval: 'daily',
      namingScheme: 'numeric',
    });

    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Write with "yesterday" timestamp first
    transport.write('old\n', makeRecord({ time: yesterday.getTime() }));
    // Write with "today" timestamp — should trigger rotation
    transport.write('new\n', makeRecord({ time: today.getTime() }));

    await transport.close();

    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('creates parent directories automatically', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'sub', 'deep', 'app.log');

    const transport = new RotateTransport({ path: logPath });
    transport.write('hello\n', makeRecord());
    await transport.close();

    const content = readFileSync(logPath, 'utf8');
    expect(content).toBe('hello\n');
  });

  it('resumes with existing file size', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    // Pre-populate the file
    writeFileSync(logPath, 'existing content\n');

    const transport = new RotateTransport({
      path: logPath,
      maxSize: '30B',
      namingScheme: 'numeric',
    });

    // Existing content is 17 bytes, adding more should trigger rotation
    transport.write('A'.repeat(20) + '\n', makeRecord());

    await transport.close();

    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it('manual rotate() creates a rotated file', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({
      path: logPath,
      namingScheme: 'numeric',
    });

    transport.write('before\n', makeRecord());
    transport.rotate();
    transport.write('after\n', makeRecord());

    await transport.close();

    const files = readdirSync(dir).sort();
    expect(files).toContain('app.log');
    expect(files).toContain('app.1.log');

    const current = readFileSync(logPath, 'utf8');
    expect(current).toBe('after\n');
  });

  it('numeric cleanup deletes oldest by index, not lexicographic order', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({
      path: logPath,
      maxSize: '10B',
      maxFiles: 2,
      namingScheme: 'numeric',
    });

    // Generate 12+ rotations so indices cross 10 (app.2.log < app.10.log lexically)
    const line = 'A'.repeat(15) + '\n';
    for (let i = 0; i < 14; i++) {
      transport.write(line, makeRecord());
    }

    await transport.close();

    const files = readdirSync(dir).filter((f) => f !== 'app.log').sort();
    expect(files.length).toBeLessThanOrEqual(2);

    // The kept files should have the HIGHEST numeric indices
    for (const f of files) {
      const idx = parseInt(f.replace('app.', '').replace('.log', ''), 10);
      expect(idx).toBeGreaterThanOrEqual(11);
    }
  });

  it('flush resolves immediately when no drain is needed', async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logPath = join(dir, 'app.log');

    const transport = new RotateTransport({ path: logPath });
    await expect(transport.flush()).resolves.toBeUndefined();
    await transport.close();
  });
});
