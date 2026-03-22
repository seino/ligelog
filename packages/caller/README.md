# @ligelog/caller

Auto-attach caller file, line number, and function name to every log record. Inspired by Loguru's `<file>:<line>:<function>` display.

## Installation

```sh
npm install @ligelog/caller
```

## Quick Start

```ts
import { createLogger } from 'ligelog'
import { createCallerHook } from '@ligelog/caller'

const logger = createLogger({ level: 'debug' })
logger.use(createCallerHook())

logger.info('hello')
// => record includes caller_file, caller_line, caller_fn
```

## Record Fields Added

| Field | Type | Description |
|-------|------|-------------|
| `caller_file` | `string` | Source file name |
| `caller_line` | `number` | Line number |
| `caller_fn` | `string` | Function name (`<anonymous>` if unnamed) |

## API

### `createCallerHook(opts?)`

Returns a `Hooks` object ready for `logger.use()`. Runs in the `onBeforeWrite` phase.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minLevel` | `LevelName` | `'debug'` | Minimum level to attach caller info |
| `stackOffset` | `number` | `0` | Extra frame offset for wrapper functions |
| `pathStyle` | `'full' \| 'basename' \| 'relative'` | `'basename'` | File path format |

### Path Styles

- **`'basename'`** — file name only (e.g. `server.ts`)
- **`'full'`** — absolute path
- **`'relative'`** — relative to `process.cwd()`

## Usage with @ligelog/pretty

Combine with `@ligelog/pretty` for caller info in dev output:

```ts
import { createLogger } from 'ligelog'
import { createCallerHook } from '@ligelog/caller'
import { PrettyTransport } from '@ligelog/pretty'

const logger = createLogger({
  transports: [new PrettyTransport()],
})
logger.use(createCallerHook())

logger.info('request received')
// => 2024-01-15 09:13:20.123 | INFO  | server.ts:42:handleRequest - request received
```

## Performance Note

Stack trace capture has a cost. In production, consider restricting to error-level and above:

```ts
logger.use(createCallerHook({ minLevel: 'error' }))
```

## License

MIT
