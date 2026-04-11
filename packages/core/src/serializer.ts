/**
 * @file serializer.ts
 * High-performance NDJSON serializer.
 *
 * Deliberately avoids `JSON.stringify` for the hot path.
 * Each known LogRecord field is appended via direct string concatenation;
 * unknown context fields are encoded by `encodeValue` which handles the
 * full JSON value space including nested objects, arrays, and Error objects.
 *
 * Benchmark note: string concatenation with a pre-built escape table
 * outperforms `JSON.stringify` on V8 for the typical log record shape
 * (flat object, mostly string values, 5–15 keys).
 */

import type { LogRecord } from './types';

// ---------------------------------------------------------------------------
// Character escape table
// ---------------------------------------------------------------------------

/**
 * Pre-built map for the characters that must be escaped inside JSON strings.
 * Lookup is O(1) — faster than a regex replace for short strings.
 */
const ESC: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

const CIRCULAR_MARKER = '[Circular]';
const MAX_DEPTH_MARKER = '[MaxDepth]';
const MAX_DEPTH = 12;

/**
 * Encode a JavaScript string as a JSON string literal (with surrounding quotes).
 * Control characters below 0x20 that are not in ESC are encoded as `\uXXXX`.
 */
function encodeStr(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    const cc = s.charCodeAt(i);
    const escaped = ESC[c];
    if (escaped) out += escaped;
    else if (cc < 32) out += `\\u${cc.toString(16).padStart(4, '0')}`;
    else if (cc === 0x2028 || cc === 0x2029) out += `\\u${cc.toString(16)}`;
    else out += c;
  }
  return out + '"';
}

// ---------------------------------------------------------------------------
// Value encoder
// ---------------------------------------------------------------------------

/**
 * Recursively encode any JavaScript value to its JSON representation.
 * `undefined` and non-finite numbers are coerced to `null` to remain
 * spec-compliant.
 *
 * Special handling:
 * - `Error` → `{ name, message, stack }`
 * - `Array` → standard JSON array
 * - Plain object → standard JSON object
 */
export function encodeValue(v: unknown): string {
  return encodeValueInternal(v, { seen: new WeakSet<object>() }, 0);
}

interface EncodeState {
  seen: WeakSet<object>;
}

function encodeValueInternal(v: unknown, state: EncodeState, depth: number): string {
  if (v === null || v === undefined) return 'null';

  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      return Number.isFinite(v) ? String(v) : 'null';
    case 'bigint':
      return encodeStr(String(v));
    case 'string':
      return encodeStr(v);
    case 'object': {
      if (v instanceof Date)
        return Number.isFinite(v.getTime()) ? encodeStr(v.toISOString()) : encodeStr('[Invalid Date]');
      if (depth >= MAX_DEPTH) return encodeStr(MAX_DEPTH_MARKER);
      if (state.seen.has(v)) return encodeStr(CIRCULAR_MARKER);
      state.seen.add(v);
      let out: string;
      if (v instanceof Error) out = encodeError(v, state, depth + 1);
      else if (Array.isArray(v)) out = encodeArray(v, state, depth + 1);
      else out = encodeObject(v as Record<string, unknown>, state, depth + 1);
      state.seen.delete(v);
      return out;
    }
  }
  return 'null';
}

/** Serialize an Error to a structured JSON object. */
function encodeError(e: Error, state: EncodeState, depth: number): string {
  const extra = e as unknown as Record<string, unknown>;
  const base: Record<string, unknown> = {
    name: e.name,
    message: e.message,
    stack: e.stack ?? '',
  };
  const keys = Object.keys(extra);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] ?? '';
    if (k === 'name' || k === 'message' || k === 'stack') continue;
    base[k] = extra[k];
  }
  return encodeObject(base, state, depth);
}

/** Serialize a JavaScript array to a JSON array literal. */
function encodeArray(arr: unknown[], state: EncodeState, depth: number): string {
  if (!arr.length) return '[]';
  let out = '[';
  for (let i = 0; i < arr.length; i++) {
    if (i) out += ',';
    out += encodeValueInternal(arr[i], state, depth);
  }
  return out + ']';
}

/** Serialize a plain object to a JSON object literal. */
function encodeObject(obj: Record<string, unknown>, state: EncodeState, depth: number): string {
  const keys = Object.keys(obj);
  if (!keys.length) return '{}';
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    if (i) out += ',';
    const k = keys[i] ?? '';
    out += encodeStr(k) + ':' + encodeValueInternal(obj[k], state, depth);
  }
  return out + '}';
}

// ---------------------------------------------------------------------------
// Timestamp helper
// ---------------------------------------------------------------------------

/** Zero-pad a single-digit number to two digits without string allocation. */
const p2 = (n: number): string => (n < 10 ? '0' + n : '' + n);

/** Zero-pad a number to three digits for milliseconds. */
const p3 = (n: number): string => (n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n);

// ---------------------------------------------------------------------------
// Main serializer
// ---------------------------------------------------------------------------

/**
 * Serialize a `LogRecord` to a single NDJSON line (trailing `\n` included).
 *
 * Field order is deterministic:
 *   `time` → `iso` → `level` → `lvl` → `pid` → `msg` → …context fields
 *
 * The `iso` field is a UTC ISO-8601 timestamp derived from `time`, provided
 * as a human-readable convenience alongside the numeric epoch.
 *
 * @param record - The fully-resolved log record to serialize.
 * @returns A JSON string ending with a newline character.
 */
export function serialize(record: LogRecord): string {
  const { level, lvl, time, msg, pid, ...rest } = record;
  const d = new Date(time);

  // Build the fixed-schema prefix via concatenation (no JSON.stringify).
  let out =
    '{"time":' +
    time +
    ',"iso":"' +
    d.getUTCFullYear() +
    '-' +
    p2(d.getUTCMonth() + 1) +
    '-' +
    p2(d.getUTCDate()) +
    'T' +
    p2(d.getUTCHours()) +
    ':' +
    p2(d.getUTCMinutes()) +
    ':' +
    p2(d.getUTCSeconds()) +
    '.' +
    p3(d.getUTCMilliseconds()) +
    'Z"' +
    ',"level":' +
    level +
    ',"lvl":"' +
    lvl +
    '"' +
    ',"pid":' +
    pid +
    ',"msg":' +
    encodeStr(msg);

  // Append arbitrary context fields spread from the caller.
  // Share a single EncodeState across all fields to avoid per-field WeakSet
  // allocation and to detect circular references across fields.
  const keys = Object.keys(rest);
  if (keys.length > 0) {
    const state: EncodeState = { seen: new WeakSet<object>() };
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i] ?? '';
      out += ',' + encodeStr(k) + ':' + encodeValueInternal(rest[k], state, 0);
    }
  }

  return out + '}\n';
}
