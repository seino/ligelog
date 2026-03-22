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

- **`'timestamp'`** — `app.2024-01-15T09-13-20.log`
- **`'numeric'`** — `app.1.log`, `app.2.log`, …

## Performance Note

This transport uses synchronous I/O (`writeSync`) to guarantee data is flushed to disk before rotation. This is reliable but blocks the event loop briefly during writes.

For ultra-high-throughput scenarios, consider the core `FileTransport` (async `WriteStream`) with an external log rotator (e.g. `logrotate`).

## License

MIT
