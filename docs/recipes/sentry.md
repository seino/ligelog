# Recipe: Sentry integration

Use `createSentryHook` to forward warn/error logs to Sentry while keeping JSON logs local.

```ts
import * as Sentry from '@sentry/node'
import { createLogger, createSentryHook } from 'ligelog'

Sentry.init({ dsn: process.env.SENTRY_DSN })

const logger = createLogger({ level: 'info' })
logger.use(createSentryHook({
  sentry: Sentry,
  minLevel: 'warn',
  captureErrors: true,
  breadcrumbs: true,
}))
```

Notes:

- Keep `captureErrors: true` to preserve stack traces from `Error` objects.
- Use `minLevel: 'error'` if warn-level volume is high.
- Call `await logger.close()` on shutdown for graceful draining.
