# Architecture

`ligelog` is a small, hook-first structured logger for Node.js.
This document explains the core data flow and extension points.

## Core components

- `Logger` (`src/logger.ts`)
  - Builds `LogRecord` objects from message + context.
  - Runs hook phases.
  - Serializes records and enqueues lines.
- `AsyncQueue` (`src/queue.ts`)
  - Fixed-size ring buffer for non-blocking dispatch.
  - Capacity is configurable via `queueSize` (power-of-two).
  - Drops entries on saturation and tracks `dropped` count.
  - Isolates transport write errors and tracks `writeErrors`.
- `serialize()` (`src/serializer.ts`)
  - NDJSON serializer with deterministic field order.
  - Supports nested objects, arrays, `Error`, `Date`, and `bigint` values.
  - Includes circular-reference and max-depth guards.
- `Transport` (`src/types.ts`)
  - Destination interface: `write(line, record)` plus optional `flush`/`close`.

## Log flow

1. `logger.info()/warn()/...` builds a `LogRecord`.
2. `onBeforeWrite` hooks can mutate or drop the entry.
3. `onSerialize` hooks can override output via `ctx.output`.
4. The line is enqueued into `AsyncQueue`.
5. `onAfterWrite` hooks run for side effects (e.g. Sentry).
6. Queue dispatches to each transport asynchronously.

## Reliability model

- The queue is bounded (default `queueSize=8192`) and uses drop-on-full behavior.
- Dropped entries are observable via `logger.getDropped()`.
- Transport write failures are observable via `logger.getWriteErrors()`.
- Hook exceptions are isolated by design:
  - `onBeforeWrite` throw => entry dropped
  - `onSerialize` throw => fallback to default serializer
  - `onAfterWrite` throw => ignored (side-effect isolation)
- `logger.flush()` waits for queue drain and transport-level `flush()`.
- `logger.close()` performs `flush()` and then calls transport `close()`.

## Child logger model

- `logger.child(ctx)` merges parent context with child context.
- Parent and children share the same internal queue.
- This provides consistent drop accounting and a shared dispatch pipeline.

## Design constraints

- Keep the core small and auditable.
- Prefer explicit behavior over hidden magic.
- Keep runtime dependencies near zero.
- Treat benchmark claims as workload-dependent, not universal.
