# @ligelog/catch

Higher-order functions that wrap sync and async functions with automatic error logging. Inspired by Loguru's `@logger.catch` decorator.

## Installation

```sh
npm install @ligelog/catch
```

## Quick Start

```ts
import { createLogger } from 'ligelog'
import { catchWith, catchAsync } from '@ligelog/catch'

const logger = createLogger()

// Synchronous
const safeParse = catchWith(logger, JSON.parse, { rethrow: false })
safeParse('invalid') // => logs error, returns undefined

// Asynchronous
const safeFetch = catchAsync(logger, fetchData, { rethrow: false })
await safeFetch('/api') // => logs error on reject, returns undefined
```

## API

### `catchWith(logger, fn, opts?)`

Wraps a synchronous function. Returns a function with the same signature.

```ts
// With rethrow (default) — same return type
const wrapped = catchWith(logger, myFn)

// Without rethrow — return type includes undefined
const wrapped = catchWith(logger, myFn, { rethrow: false })
```

### `catchAsync(logger, fn, opts?)`

Wraps an async function. Returns an async function with the same signature.

```ts
const wrapped = catchAsync(logger, myAsyncFn, { rethrow: false })
```

### `CatchOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LevelName` | `'error'` | Log level for caught errors |
| `rethrow` | `boolean` | `true` | Re-throw after logging |
| `message` | `string` | `'Caught exception in <fnName>'` | Custom log message |
| `extra` | `(error, args) => Record` | — | Extract additional context |

## Examples

### Custom log level

```ts
const wrapped = catchWith(logger, riskyFn, { level: 'fatal' })
```

### Extra context

```ts
const wrapped = catchWith(logger, processOrder, {
  extra: (error, args) => ({ orderId: args[0], step: 'validation' }),
})
```

### Preserves `this` context

```ts
class Service {
  process = catchWith(logger, this._process.bind(this))
  private _process(id: string) { /* ... */ }
}
```

## License

MIT
