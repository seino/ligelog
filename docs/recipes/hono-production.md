# Recipe: Hono production logging

A production logging setup for Hono using ligelog ecosystem packages. Works on Node.js and edge runtimes.

## What you get

- **Structured JSON logs** with request ID, method, path, status, duration
- **PII masking** — sensitive fields redacted before serialization
- **Request-scoped child logger** accessible via `c.get('log')`
- **Edge-compatible** — no `AsyncLocalStorage` dependency in the middleware itself

## Install

```sh
npm install ligelog @ligelog/http @ligelog/redact
```

## Setup

```ts
import { Hono } from 'hono';
import { createLogger } from 'ligelog';
import { honoLogger } from '@ligelog/http/hono';
import { createRedactHook } from '@ligelog/redact';

// --- Logger ---
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
});

logger.use(createRedactHook({
  paths: [
    'password',
    'token',
    'headers.authorization',
    'headers.cookie',
  ],
}));

// --- Hono app ---
const app = new Hono();

// HTTP request logging (stores child logger at c.get('log'))
app.use(honoLogger({ logger }));

// Routes — use c.get('log') for request-scoped logging
app.post('/api/users', async (c) => {
  const log = c.get('log');
  log.info('creating user');

  const body = await c.req.json();
  log.info('user payload received', { email: body.email });

  return c.json({ ok: true }, 201);
});

export default app;
```

## Adding AsyncLocalStorage context (Node.js only)

On Node.js, you can combine with `@ligelog/context` for automatic field propagation:

```sh
npm install @ligelog/context
```

```ts
import { createContextStore, createContextHook } from '@ligelog/context';

const store = createContextStore();
logger.use(createContextHook(store));

// Wrap each request in a context scope
app.use(async (c, next) => {
  const requestId = c.get('requestId');
  await store.run({ requestId }, () => next());
});
```

> **Note:** `AsyncLocalStorage` is not available in Cloudflare Workers or Deno Deploy.
> On edge runtimes, use Hono's built-in `c.set()` / `c.get()` for request-scoped state instead.

## Hook execution order

Hooks run in registration order:

1. `@ligelog/redact` — masks PII fields
2. `@ligelog/context` — injects context fields (if using)
3. Core serializer — converts to NDJSON

Register `redact` before `context` so context-injected fields are not accidentally masked.

## Example log output

```json
{"level":"info","lvl":30,"time":1713100800000,"msg":"request completed","requestId":"a1b2c3d4-ef56","req":{"method":"POST","url":"http://localhost:3000/api/users","path":"/api/users","headers":{"authorization":"[REDACTED]"}},"res":{"statusCode":201},"duration":8.7}
```
