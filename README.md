# ligelog

**ligelog** (from Spanish *ligero* — lightweight) is a lightweight, hook-based structured JSON logger for Node.js, written in TypeScript.

- Zero runtime dependencies
- Custom NDJSON serializer for predictable output and low overhead
- Non-blocking async ring-buffer queue (`queueMicrotask`)
- Hook pipeline: `onBeforeWrite` → `onSerialize` → `onAfterWrite`
- First-class Sentry integration via `createSentryHook`
- ESM + CJS dual build

## Positioning

`ligelog` is designed for teams that want:

- a small logging surface area
- structured JSON output by default
- lightweight extension points (hooks) without a large plugin ecosystem

If you need proven highest-throughput logging under many workloads, benchmark against your setup (see "Performance notes" below) before choosing.

## Design goals

- Small, auditable core (easy to read and maintain)
- Safe extensibility through hooks
- Predictable JSON output with minimal setup

## Non-goals

- Replacing mature logger ecosystems in every scenario
- Claiming universal "faster than X" results without workload-specific benchmarks

## When to choose ligelog

| Choose `ligelog` when... | Prefer another logger when... |
| ------------------------ | ----------------------------- |
| You want a small, auditable codebase. | You need a large plugin ecosystem out of the box. |
| You want hook-first extension points (`onBeforeWrite` / `onSerialize` / `onAfterWrite`). | You need battle-tested defaults for many logging backends. |
| You care about predictable NDJSON output with minimal setup. | Your top priority is maximum proven throughput across diverse workloads. |
| You want explicit control over drops/back-pressure (`getDropped()`). | You prefer a logger with broad community benchmarks and long production history. |
| You want to monitor transport failures (`getWriteErrors()`). | You need built-in retry queues and durable delivery semantics. |

---

## Installation

```sh
npm install ligelog
```

Sentry integration requires `@sentry/node` (or any compatible SDK) as a peer dependency:

```sh
npm install @sentry/node
```

---

## Quick start

```ts
import { createLogger, FileTransport } from 'ligelog'

const logger = createLogger({
  level:   'info',
  context: { app: 'api-server', env: process.env.NODE_ENV },
  transports: [
    // StdoutTransport is added automatically when omitted.
    new FileTransport({ path: './logs/app.log' }),
  ],
})

logger.info('server started', { port: 3000 })
logger.warn('high memory usage', { heapMb: 512 })
logger.error('unhandled error', { error: new Error('ETIMEOUT') })

// Flush buffered entries before process exit.
process.on('beforeExit', () => logger.close())

// Optional: lightweight health telemetry for logging reliability.
setInterval(() => {
  const dropped = logger.getDropped()
  const writeErrors = logger.getWriteErrors()
  if (dropped > 0 || writeErrors > 0) {
    logger.warn('logger health warning', { dropped, writeErrors })
  }
}, 60_000)
```

**Output** (one JSON line per entry):

```json
{"time":1700000000000,"iso":"2023-11-14T22:13:20Z","level":20,"lvl":"info","pid":1234,"msg":"server started","app":"api-server","env":"production","port":3000}
```

---

## Log levels

| Name    | Value |
|---------|-------|
| `debug` | 10    |
| `info`  | 20    |
| `warn`  | 30    |
| `error` | 40    |
| `fatal` | 50    |

---

## Performance notes

`ligelog` is optimized for low overhead and operational simplicity, but real-world performance depends on:

- Node.js version
- transport mix (`stdout`, file, remote sinks)
- log shape (flat vs deeply nested context)
- workload pattern (steady stream vs bursts)

For fair comparisons (including against Pino), benchmark in your production-like environment and report:

- throughput (logs/sec)
- p95/p99 latency impact
- memory usage
- dropped entry count (`logger.getDropped()`)

Run the built-in comparison benchmark:

```sh
npm run bench:compare
```

Optional tuning knobs:

```sh
BENCH_ITERATIONS=500000 BENCH_WARMUP=50000 BENCH_FLUSH_EVERY=1000 npm run bench:compare
```

---

## Serialization behavior

- `bigint` values are encoded as strings (example: `123n` -> `"123"`).
- `Date` values are encoded as ISO strings.
- `Error` values include `name`, `message`, `stack`, and enumerable custom properties.
- Circular references are replaced with `"[Circular]"`.
- Very deep object graphs are capped and replaced with `"[MaxDepth]"`.

---

## Child loggers

Use `logger.child(ctx)` to create a scoped logger that inherits the parent's
transports, hooks, and context while adding its own fields.
All children share the same async queue.
Child loggers copy hooks at creation time (snapshot semantics).

```ts
// Per-request child logger in a React Router loader
export async function loader({ request }: Route.LoaderArgs) {
  const log = logger.child({ requestId: crypto.randomUUID(), route: 'users' })
  log.info('request received', { method: request.method })
  // ...
}
```

---

## Hooks

Hooks let you filter, transform, or react to log entries without modifying
the core logger.

```ts
logger.use(hooks)   // chainable — returns the same logger instance
```

### `onBeforeWrite`

Called before serialization. Return `false` to silently drop the entry.

```ts
logger.use({
  onBeforeWrite: [ctx => {
    // Drop health-check noise from the log
    if (ctx.record.path === '/healthz') return false
    return ctx
  }],
})
```

### `onSerialize`

Override the default NDJSON format. Set `ctx.output` to replace the serialized string.

```ts
logger.use({
  onSerialize: [ctx => ({
    ...ctx,
    output: `[${ctx.record.lvl.toUpperCase()}] ${ctx.record.msg}\n`,
  })],
})
```

### `onAfterWrite`

Side-effects after the line has been queued (forwarding to external services).
Must not throw — wrap your implementation in `try/catch`.

Hook failures are isolated by default so your application flow is not interrupted.

```ts
logger.use({
  onAfterWrite: [({ record }) => {
    myMetricsClient.increment('log_entries', { level: record.lvl })
  }],
})
```

---

## Sentry integration

```ts
import * as Sentry from '@sentry/node'
import { createLogger, createSentryHook } from 'ligelog'

Sentry.init({ dsn: process.env.SENTRY_DSN })

const logger = createLogger({ level: 'info' })

logger.use(createSentryHook({
  sentry:        Sentry,
  minLevel:      'error',   // only forward error and fatal
  captureErrors: true,      // use captureException when an Error is present
  breadcrumbs:   true,      // also add Sentry breadcrumbs
}))

// Error objects in extra fields are forwarded via captureException.
logger.error('db connection failed', { error: new Error('ECONNREFUSED') })
```

### `createSentryHook` options

| Option          | Type         | Default  | Description                                                           |
|-----------------|--------------|----------|-----------------------------------------------------------------------|
| `sentry`        | `SentryLike` | —        | Initialized Sentry SDK instance.                                      |
| `minLevel`      | `LevelName`  | `'warn'` | Entries below this level are ignored by the hook.                     |
| `captureErrors` | `boolean`    | `true`   | Use `captureException` when an `Error` is found in the extra fields.  |
| `breadcrumbs`   | `boolean`    | `true`   | Also add Sentry breadcrumbs for timeline context.                     |

---

## Transports

### `StdoutTransport` (default)

Writes to `process.stdout`. Used automatically when no transports are specified.

### `FileTransport`

```ts
new FileTransport({ path: './logs/app.log' })
```

Appends to a file via a `fs.WriteStream`. Parent directories are created automatically.

### Custom transport

Implement the `Transport` interface:

```ts
import type { Transport, LogRecord } from 'ligelog'

class MyTransport implements Transport {
  write(line: string, record: LogRecord): void {
    // `line` is the serialized NDJSON string (trailing \n included).
    // `record` is the original LogRecord for level-based routing.
    myService.send(line)
  }

  async flush(): Promise<void> { /* optional */ }
  async close(): Promise<void> { /* optional */ }
}
```

---

## API reference

### `createLogger(opts?)`

Factory function. Returns a `Logger` instance.

| Option       | Type          | Default            |
|--------------|---------------|--------------------|
| `level`      | `LevelName`   | `'info'`           |
| `context`    | `object`      | `{}`               |
| `transports` | `Transport[]` | `[StdoutTransport]`|
| `hooks`      | `Hooks`       | `{}`               |
| `queueSize`  | `number`      | `8192`             |

### `logger.child(ctx)`

Returns a new `Logger` that inherits the parent's configuration and merges `ctx`.

### `logger.use(hooks)`

Appends hooks to the pipeline. Chainable.

### `logger.flush()`

Returns a `Promise` that resolves when all queued entries have been written.

### `logger.close()`

Returns a `Promise` that resolves after queue drain, transport flush, and transport close.

### `logger.getDropped()`

Returns the number of entries dropped due to queue back-pressure.

### `logger.getWriteErrors()`

Returns the number of transport write failures observed by the async queue.

---

## Documentation

- [Architecture](./docs/architecture.md)
- [Benchmarks](./docs/benchmarks.md)
- [Recipe: Sentry integration](./docs/recipes/sentry.md)
- [Recipe: graceful shutdown](./docs/recipes/production-shutdown.md)

---

## License

MIT
