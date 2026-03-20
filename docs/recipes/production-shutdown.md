# Recipe: graceful production shutdown

For containers and process managers, flush and close transports on termination signals.

```ts
import { createLogger } from 'ligelog'

const logger = createLogger({ level: 'info' })

async function shutdown(signal: string): Promise<void> {
  logger.warn('shutdown signal received', { signal })
  await logger.close()
  process.exit(0)
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1))
})

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1))
})
```

Notes:

- Prefer `logger.close()` over `logger.flush()` during shutdown.
- Keep shutdown handlers idempotent in real services.
