# ligelog

**ligelog** (from Spanish *ligero* — lightweight) is a lightweight, hook-based structured JSON logger for Node.js, written in TypeScript.

- Zero runtime dependencies
- Custom NDJSON serializer for predictable output and low overhead
- Non-blocking async ring-buffer queue (`queueMicrotask`)
- Hook pipeline: `onBeforeWrite` → `onSerialize` → `onAfterWrite`
- Ecosystem architecture — extend via `@ligelog/*` packages
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

Add ecosystem packages as needed — each is optional and independently installable:

```sh
npm install @ligelog/pretty   # colorized dev output
npm install @ligelog/rotate   # file rotation
npm install @ligelog/caller   # caller info (file, line, function)
npm install @ligelog/catch    # automatic error logging wrappers
npm install @ligelog/sentry   # Sentry integration
```

See [Ecosystem](#ecosystem) for details.

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

> Benchmarks are run to monitor performance regressions across ligelog versions, not to claim superiority over other loggers.
> Results depend heavily on workload, I/O, and runtime environment. We recommend re-measuring under your own production conditions before making adoption decisions.

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

## Ecosystem

ligelog uses an ecosystem architecture. The core package stays small and fast, while integrations are provided as separate `@ligelog/*` packages.

| Package | Description |
|---------|-------------|
| [`ligelog`](./packages/core) | Core logger — zero dependencies |
| [`@ligelog/caller`](./packages/caller) | Auto-attach caller file, line, and function name |
| [`@ligelog/catch`](./packages/catch) | Wrap functions with automatic error logging |
| [`@ligelog/context`](./packages/context) | AsyncLocalStorage-based context propagation |
| [`@ligelog/http`](./packages/http) | Express and Hono request logging middleware |
| [`@ligelog/pretty`](./packages/pretty) | Colorized human-readable output for development |
| [`@ligelog/redact`](./packages/redact) | PII field masking with glob patterns |
| [`@ligelog/rotate`](./packages/rotate) | Size and time-based log file rotation |
| [`@ligelog/sampling`](./packages/sampling) | Log volume reduction (rate/count-based) |
| [`@ligelog/sentry`](./packages/sentry) | Sentry integration via `onAfterWrite` hook |
| [`@ligelog/test`](./packages/test) | CaptureTransport and assertion helpers for testing |

### Common combinations

Pick the packages that match your use case:

| Use case | Packages |
|----------|----------|
| **Development** | `ligelog` + `@ligelog/pretty` + `@ligelog/caller` |
| **Express production** | `ligelog` + `@ligelog/http` + `@ligelog/redact` + `@ligelog/context` |
| **Hono / Edge** | `ligelog` + `@ligelog/http` + `@ligelog/redact` |
| **High-traffic service** | Add `@ligelog/sampling` to any of the above |
| **Testing** | `@ligelog/test` in devDependencies |

See [Express production recipe](./docs/recipes/express-production.md) and [Hono production recipe](./docs/recipes/hono-production.md) for complete working examples.

### Caller info

```sh
npm install @ligelog/caller
```

```ts
import { createLogger } from 'ligelog'
import { createCallerHook } from '@ligelog/caller'

const logger = createLogger({ level: 'debug' })
logger.use(createCallerHook())

logger.info('hello') // => record includes caller_file, caller_line, caller_fn
```

### Error catching

```sh
npm install @ligelog/catch
```

```ts
import { createLogger } from 'ligelog'
import { catchWith, catchAsync } from '@ligelog/catch'

const logger = createLogger()

const safeParseJson = catchWith(logger, JSON.parse, { rethrow: false })
safeParseJson('invalid') // => logs error, returns undefined

const safeFetch = catchAsync(logger, fetchData, { rethrow: false })
await safeFetch('/api') // => logs error on reject, returns undefined
```

### Pretty output

```sh
npm install @ligelog/pretty
```

```ts
import { createLogger } from 'ligelog'
import { PrettyTransport } from '@ligelog/pretty'

const logger = createLogger({
  transports: [new PrettyTransport()],
})
// Output: 2024-01-15 09:13:20.123 | INFO  | server started  port=3000
```

### Log rotation

```sh
npm install @ligelog/rotate
```

```ts
import { createLogger } from 'ligelog'
import { RotateTransport } from '@ligelog/rotate'

const logger = createLogger({
  transports: [
    new RotateTransport({
      path: './logs/app.log',
      maxSize: '50MB',
      rotateInterval: 'daily',
      maxFiles: 30,
    }),
  ],
})
```

### Sentry integration

```sh
npm install @ligelog/sentry @sentry/node
```

```ts
import * as Sentry from '@sentry/node'
import { createLogger } from 'ligelog'
import { createSentryHook } from '@ligelog/sentry'

Sentry.init({ dsn: process.env.SENTRY_DSN })

const logger = createLogger({ level: 'info' })

logger.use(createSentryHook({
  sentry:        Sentry,
  minLevel:      'error',
  captureErrors: true,
  breadcrumbs:   true,
}))
```

See [`@ligelog/sentry` README](./packages/sentry) for full options.

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
| `onHookError` | `(phase, error) => void` | —     |
| `onDrop`     | `(dropped) => void` | —           |

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
- [Recipe: Express production logging](./docs/recipes/express-production.md)
- [Recipe: Hono production logging](./docs/recipes/hono-production.md)
- [Recipe: Sentry integration](./docs/recipes/sentry.md)
- [Recipe: graceful shutdown](./docs/recipes/production-shutdown.md)

---

## License

MIT
