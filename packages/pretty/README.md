# @ligelog/pretty

Colorized, human-readable transport for development. Zero external dependencies — uses raw ANSI escape codes.

## Installation

```sh
npm install @ligelog/pretty
```

## Quick Start

```ts
import { createLogger } from 'ligelog'
import { PrettyTransport } from '@ligelog/pretty'

const logger = createLogger({
  transports: [new PrettyTransport()],
})

logger.info('server started', { port: 3000 })
```

## Output Format

```
2024-01-15 09:13:20.123 | INFO  | server started  port=3000
2024-01-15 09:13:20.456 | ERROR | app.ts:42:handleRequest - db failed  error=ECONNREFUSED
```

When combined with `@ligelog/caller`, caller info is displayed as `file:line:function`.

## API

### `new PrettyTransport(opts?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `colorize` | `boolean` | auto | ANSI color output (auto-detects TTY and `NO_COLOR`) |
| `timestamp` | `'iso' \| 'local' \| 'elapsed'` | `'local'` | Timestamp format |
| `extraStyle` | `'inline' \| 'json' \| 'hide'` | `'inline'` | Extra field display style |
| `levelColors` | `Partial<Record<LevelName, fn>>` | built-in | Custom level color functions |
| `output` | `NodeJS.WritableStream` | `process.stdout` | Output stream |

### Timestamp Formats

- **`'local'`** — `2024-01-15 09:13:20.123` (local time)
- **`'iso'`** — `2024-01-15T09:13:20.123Z` (UTC)
- **`'elapsed'`** — `+1.234s` (seconds since transport creation)

### Extra Field Styles

- **`'inline'`** — `key=value` pairs appended to the line
- **`'json'`** — JSON stringified block
- **`'hide'`** — omit extra fields entirely

## Usage with @ligelog/caller

```ts
import { createLogger } from 'ligelog'
import { createCallerHook } from '@ligelog/caller'
import { PrettyTransport } from '@ligelog/pretty'

const logger = createLogger({
  transports: [new PrettyTransport()],
})
logger.use(createCallerHook())
```

## License

MIT
