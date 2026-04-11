# @ligelog/rotate

File rotation transport with size-based and time-based triggers. Zero external dependencies.

## Installation

```sh
npm install @ligelog/rotate
```

## Quick Start

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

## API

### `new RotateTransport(opts)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | *required* | Base log file path |
| `maxSize` | `SizeSpec` | — | Size threshold for rotation |
| `rotateInterval` | `RotateInterval` | — | Time-based rotation interval |
| `maxFiles` | `number` | `0` (unlimited) | Max rotated files to keep |
| `namingScheme` | `'timestamp' \| 'numeric'` | `'timestamp'` | Rotated file naming |

### `transport.rotate()`

Manually trigger a file rotation.

### Size Specification

Accepts a number (bytes) or a string with unit:

```ts
'10MB'   // 10 * 1024 * 1024 bytes
'1GB'    // 1 * 1024^3 bytes
'500KB'  // 500 * 1024 bytes
1048576  // raw bytes
```

### Rotation Intervals

`'hourly'` | `'daily'` | `'weekly'` | `'monthly'`

Size and time triggers can be used together — rotation occurs when either threshold is reached.

### Naming Schemes

- **`'timestamp'`** — `app.2024-01-15T09-13-20-123.log` (millisecond precision to avoid collisions when rotations happen in rapid succession; if the same millisecond is hit twice, a `-1`, `-2`, … suffix is appended so no file is ever overwritten)
- **`'numeric'`** — `app.1.log`, `app.2.log`, …

## When to use this transport

`@ligelog/rotate` is optimized for **operational simplicity and durability**, not for peak throughput. It is a good fit when:

- You want the app itself to own log rotation (no external daemon, no Docker sidecar).
- You care about **never losing a write around the rotation boundary** — `writeSync` + `closeSync` guarantees that every byte has been handed off to the OS before the file is renamed (see [Operational constraints](#operational-constraints) for the fsync caveat).
- Your write rate is moderate (say, up to a few thousand lines per second).

## High-throughput alternatives

Because the transport uses **synchronous I/O** (`writeSync`), it blocks the event loop for the duration of every write. Under extreme throughput (tens of thousands of lines per second or large per-line payloads) this becomes the dominant cost in your process.

If you hit that ceiling, pick one of the following alternatives instead:

### 1. Core `FileTransport` + external rotator (recommended)

Use ligelog's built-in `FileTransport`, which wraps a Node.js `WriteStream` (async, buffered, non-blocking), and delegate rotation to a battle-tested external tool:

```ts
import { createLogger, FileTransport } from 'ligelog'

const logger = createLogger({
  transports: [new FileTransport({ path: '/var/log/app/app.log' })],
})
```

Then rotate via one of:

- **`logrotate`** (Linux) — signal-based rotation via `copytruncate` or `SIGHUP` reopen.
- **`newsyslog`** (macOS / BSD).
- **Docker / Kubernetes** — let the container runtime rotate stdout (`json-file` driver, `max-size`, `max-file`).

This gives you async, non-blocking writes **and** robust rotation, at the cost of one more moving part in your deployment.

### 2. stdout + a log shipper

For container-first deployments, the idiomatic answer is: don't write files at all. Log to stdout and let the platform (Kubernetes, ECS, journald, Vector, Fluent Bit, Loki, Datadog Agent, …) collect, rotate, and ship:

```ts
import { createLogger, ConsoleTransport } from 'ligelog'

const logger = createLogger({
  transports: [new ConsoleTransport()],
})
```

### 3. Keep `@ligelog/rotate` but soften the impact

If you want to stay on this transport under sustained load:

- **Increase `maxSize`** so rotations are rarer (each rotation incurs one `closeSync` + `renameSync` + `openSync`).
- **Avoid huge `maxFiles`** values — cleanup scans the directory on every rotate.
- **Write smaller records** — the cost is proportional to bytes written, not line count.

## Performance Note

This transport uses synchronous I/O (`writeSync`) to guarantee data is flushed to disk before rotation. This is reliable but blocks the event loop briefly during writes. See [High-throughput alternatives](#high-throughput-alternatives) above if that tradeoff does not fit your workload.

## Operational constraints

A few things this transport **does not** try to solve — read these before deploying:

- **Single-writer per file.** `@ligelog/rotate` assumes exactly one process owns the base path. Multiple processes writing to the same `app.log` (cluster mode, `pm2 -i N`, multiple containers sharing a host volume) will race on `renameSync`, double-rotate, and potentially overwrite each other's in-flight writes. If you need multi-process logging, give each process its own path (e.g. `app.${pid}.log`) or send through stdout + a log shipper (see [High-throughput alternatives](#high-throughput-alternatives)).
- **Event-loop blocking.** Every write is a synchronous `writeSync`. That is the whole point (durability around rotation), but it means latency-sensitive request handlers will feel the cost under load. Measure before adopting under heavy write rates.
- **No fsync on every line.** Writes go through the OS page cache. A hard crash (kernel panic, power loss) can still lose the last few records — `writeSync` only guarantees the bytes have left your process.

## License

MIT
