# @ligelog/sentry

Sentry integration hook for [ligelog](https://www.npmjs.com/package/ligelog).

Forwards log entries to Sentry via the `onAfterWrite` hook phase, preserving the original `LogRecord` with typed fields and Error objects for richer context.

## Installation

```sh
npm install @ligelog/sentry @sentry/node
```

`@sentry/node` (>=7) is a **peer dependency**.

## Quick Start

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

## Behavior by Log Level

| Level | `captureErrors: true` (default) | `captureErrors: false` |
|-------|----------------------------------|------------------------|
| debug | breadcrumb only (if enabled) | breadcrumb only |
| info  | breadcrumb only | breadcrumb only |
| warn  | `captureMessage` + breadcrumb | `captureMessage` + breadcrumb |
| error | `captureException` if Error present, else `captureMessage` | `captureMessage` |
| fatal | same as error | `captureMessage` |

## API

### `createSentryHook(opts)`

Returns a `Hooks` object ready for `logger.use()`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sentry` | `SentryLike` | *required* | Initialized Sentry SDK instance |
| `captureErrors` | `boolean` | `true` | Use `captureException` for Error objects at error/fatal level |
| `breadcrumbs` | `boolean` | `true` | Add breadcrumbs for timeline context |
| `minLevel` | `LevelName` | `'warn'` | Minimum level to forward to Sentry |

### `SentryLike` interface

Minimal interface compatible with `@sentry/node`, `@sentry/browser`, `@sentry/nextjs`, etc.:

```ts
interface SentryLike {
  captureException(err: unknown, hint?: { extra?: Record<string, unknown> }): void
  captureMessage(msg: string, level?: string, hint?: { extra?: Record<string, unknown> }): void
  addBreadcrumb(b: { message: string; level?: string; data?: Record<string, unknown> }): void
}
```

## License

MIT
