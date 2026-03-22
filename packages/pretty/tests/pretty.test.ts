/**
 * @file tests/pretty.test.ts
 * Tests for PrettyTransport.
 */

import { describe, it, expect, vi } from 'vitest';
import { PrettyTransport } from '../src/index';
import type { LogRecord } from 'ligelog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 20,
    lvl: 'info',
    time: new Date('2024-01-15T09:13:20.123Z').getTime(),
    msg: 'test message',
    pid: 1,
    ...overrides,
  };
}

function captureOutput(opts: ConstructorParameters<typeof PrettyTransport>[0] = {}) {
  const lines: string[] = [];
  const output = {
    write: vi.fn((chunk: string) => { lines.push(chunk); }),
  } as unknown as NodeJS.WritableStream;

  const transport = new PrettyTransport({ colorize: false, output, ...opts });
  return { transport, lines, output };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrettyTransport', () => {
  it('writes a human-readable line to the output stream', () => {
    const { transport, lines } = captureOutput();
    const record = makeRecord();

    transport.write('', record);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('INFO');
    expect(lines[0]).toContain('test message');
    expect(lines[0]).toMatch(/\n$/);
  });

  it('pads level names to 5 characters', () => {
    const { transport, lines } = captureOutput();

    transport.write('', makeRecord({ lvl: 'info' }));
    transport.write('', makeRecord({ lvl: 'warn' }));
    transport.write('', makeRecord({ level: 40, lvl: 'error' }));

    expect(lines[0]).toContain('INFO ');
    expect(lines[1]).toContain('WARN ');
    expect(lines[2]).toContain('ERROR');
  });

  it('uses local timestamp format by default', () => {
    const { transport, lines } = captureOutput();
    transport.write('', makeRecord());

    // Should contain date-like pattern (local time varies by TZ)
    expect(lines[0]).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it('uses ISO timestamp when configured', () => {
    const { transport, lines } = captureOutput({ timestamp: 'iso' });
    transport.write('', makeRecord());

    expect(lines[0]).toContain('2024-01-15T09:13:20.123Z');
  });

  it('uses elapsed timestamp when configured', () => {
    const { transport, lines } = captureOutput({ timestamp: 'elapsed' });
    // Use a record with time close to now so elapsed is positive
    transport.write('', makeRecord({ time: Date.now() + 100 }));

    expect(lines[0]).toMatch(/\+\d+\.\d{3}s/);
  });

  it('shows extra fields inline by default', () => {
    const { transport, lines } = captureOutput();
    const record = makeRecord({ requestId: 'abc-123', method: 'GET' });

    transport.write('', record);

    expect(lines[0]).toContain('requestId=abc-123');
    expect(lines[0]).toContain('method=GET');
  });

  it('shows extra fields as JSON when extraStyle is json', () => {
    const { transport, lines } = captureOutput({ extraStyle: 'json' });
    const record = makeRecord({ port: 3000 });

    transport.write('', record);

    expect(lines[0]).toContain('"port":3000');
  });

  it('hides extra fields when extraStyle is hide', () => {
    const { transport, lines } = captureOutput({ extraStyle: 'hide' });
    const record = makeRecord({ secret: 'hidden' });

    transport.write('', record);

    expect(lines[0]).not.toContain('secret');
    expect(lines[0]).not.toContain('hidden');
  });

  it('includes caller info when present on the record', () => {
    const { transport, lines } = captureOutput();
    const record = makeRecord({
      caller_file: 'app.ts',
      caller_line: 42,
      caller_fn: 'handleRequest',
    });

    transport.write('', record);

    expect(lines[0]).toContain('app.ts:42:handleRequest');
    expect(lines[0]).toContain('-');
  });

  it('omits caller function when it is <anonymous>', () => {
    const { transport, lines } = captureOutput();
    const record = makeRecord({
      caller_file: 'index.ts',
      caller_line: 10,
      caller_fn: '<anonymous>',
    });

    transport.write('', record);

    expect(lines[0]).toContain('index.ts:10');
    expect(lines[0]).not.toContain('<anonymous>');
  });

  it('outputs ANSI colors when colorize is true', () => {
    const { transport, lines } = captureOutput({ colorize: true });
    transport.write('', makeRecord());

    // Should contain ANSI escape codes
    expect(lines[0]).toContain('\x1b[');
  });

  it('omits ANSI colors when colorize is false', () => {
    const { transport, lines } = captureOutput({ colorize: false });
    transport.write('', makeRecord());

    expect(lines[0]).not.toContain('\x1b[');
  });

  it('formats Error values as their message in extras', () => {
    const { transport, lines } = captureOutput();
    const record = makeRecord({ error: new Error('db connection failed') });

    transport.write('', record);

    expect(lines[0]).toContain('error=db connection failed');
  });

  it('excludes standard LogRecord keys from extras', () => {
    const { transport, lines } = captureOutput();
    transport.write('', makeRecord());

    // Standard keys should not appear as key=value pairs
    expect(lines[0]).not.toMatch(/level=\d/);
    expect(lines[0]).not.toContain('lvl=info');
    expect(lines[0]).not.toContain('pid=');
  });
});
