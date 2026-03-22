# ligelog

**ligelog** (from Spanish *ligero* — lightweight) is a lightweight, hook-based structured JSON logger for Node.js, written in TypeScript.

- Zero runtime dependencies
- Custom NDJSON serializer for predictable output and low overhead
- Non-blocking async ring-buffer queue (`queueMicrotask`)
- Hook pipeline: `onBeforeWrite` → `onSerialize` → `onAfterWrite`
- ESM + CJS dual build

## Installation

```sh
npm install ligelog
```

## Quick Start

```ts
import { createLogger, FileTransport } from 'ligelog'

const logger = createLogger({
  level:   'info',
  context: { app: 'api-server', env: process.env.NODE_ENV },
  transports: [
    new FileTransport({ path: './logs/app.log' }),
  ],
})

logger.info('server started', { port: 3000 })
logger.error('unhandled error', { error: new Error('ETIMEOUT') })

process.on('beforeExit', () => logger.close())
```

**Output** (one JSON line per entry):

```json
{"time":1700000000000,"iso":"2023-11-14T22:13:20Z","level":20,"lvl":"info","pid":1234,"msg":"server started","app":"api-server","port":3000}
```

## Log Levels

| Name    | Value |
|---------|-------|
| `debug` | 10    |
| `info`  | 20    |
| `warn`  | 30    |
| `error` | 40    |
| `fatal` | 50    |

## API Reference

### `createLogger(opts?)`

Factory function. Returns a `Logger` instance.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LevelName` | `'info'` | Minimum level to emit |
| `context` | `Record<string, unknown>` | `{}` | Static fields merged into every record |
| `transports` | `Transport[]` | `[StdoutTransport]` | Output destinations |
| `hooks` | `Hooks` | `{}` | Lifecycle hooks |
| `queueSize` | `number` | `8192` | Ring buffer capacity (power of 2) |
| `onHookError` | `(phase, error) => void` | — | Called when a hook throws |
| `onDrop` | `(dropped) => void` | — | Called when an entry is dropped due to back-pressure |

### `logger.debug(msg, extra?)` / `.info()` / `.warn()` / `.error()` / `.fatal()`

Emit a log entry at the given level. `extra` fields are shallow-merged with the logger context.

### `logger.child(ctx)`

Create a scoped logger that inherits transports, hooks, and context, then merges `ctx` on top. All children share the parent's async queue.

### `logger.use(hooks)`

Append hooks to the pipeline. Returns `this` for chaining.

### `logger.flush()`

Returns a `Promise` that resolves when all queued entries have been written.

### `logger.close()`

Flush, then close all transports. Call before process exit.

### `logger.getDropped()`

Returns the number of entries dropped due to queue back-pressure.

### `logger.getWriteErrors()`

Returns the number of transport write failures observed.

## Hooks

### `onBeforeWrite`

Called before serialization. Return `false` to drop the entry.

```ts
logger.use({
  onBeforeWrite: [ctx => {
    if (ctx.record.path === '/healthz') return false
    return ctx
  }],
})
```

### `onSerialize`

Override the default NDJSON format. Set `ctx.output` to replace the serialized string.

### `onAfterWrite`

Side-effects after the line has been queued (e.g. forwarding to external services).

## Transports

### `StdoutTransport` (default)

Writes to `process.stdout`. Used automatically when no transports are specified.

### `FileTransport`

```ts
new FileTransport({ path: './logs/app.log' })
```

Appends to a file via `fs.WriteStream`. Parent directories are created automatically.

### Custom Transport

Implement the `Transport` interface:

```ts
import type { Transport, LogRecord } from 'ligelog'

class MyTransport implements Transport {
  write(line: string, record: LogRecord): void {
    myService.send(line)
  }
  async flush(): Promise<void> { /* optional */ }
  async close(): Promise<void> { /* optional */ }
}
```

## Serialization Behavior

- `bigint` → strings (`123n` → `"123"`)
- `Date` → ISO strings
- `Error` → `{ name, message, stack }` + enumerable custom properties
- Circular references → `"[Circular]"`
- Deep objects (>12 levels) → `"[MaxDepth]"`

## Ecosystem

Extend ligelog with `@ligelog/*` packages:

| Package | Description |
|---------|-------------|
| [`@ligelog/caller`](https://www.npmjs.com/package/@ligelog/caller) | Auto-attach caller file, line, and function name |
| [`@ligelog/catch`](https://www.npmjs.com/package/@ligelog/catch) | Wrap functions with automatic error logging |
| [`@ligelog/pretty`](https://www.npmjs.com/package/@ligelog/pretty) | Colorized human-readable output for development |
| [`@ligelog/rotate`](https://www.npmjs.com/package/@ligelog/rotate) | Size and time-based log file rotation |
| [`@ligelog/sentry`](https://www.npmjs.com/package/@ligelog/sentry) | Sentry integration via `onAfterWrite` hook |

## License

MIT
