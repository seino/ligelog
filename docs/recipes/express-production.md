# Recipe: Express production logging

A full-stack logging setup for Express using ligelog ecosystem packages.

## What you get

- **Structured JSON logs** with request ID, method, path, status, duration
- **PII masking** — passwords, tokens, and email addresses never reach your log storage
- **Request-scoped context** — `requestId` and `userId` automatically attached to every log in the request lifecycle
- **Graceful shutdown** — no lost log entries on deploy

## Install

```sh
npm install ligelog @ligelog/http @ligelog/redact @ligelog/context
```

## Setup

```ts
import express from 'express';
import { createLogger, FileTransport } from 'ligelog';
import { expressLogger } from '@ligelog/http/express';
import { createRedactHook } from '@ligelog/redact';
import { createContextStore, createContextHook } from '@ligelog/context';

// --- Context store (request-scoped fields) ---
const store = createContextStore();

// --- Logger ---
const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [new FileTransport({ path: './logs/app.log' })],
});

logger.use(createRedactHook({
  paths: [
    'password',
    'token',
    'headers.authorization',
    'headers.cookie',
    'user.*.ssn',
  ],
}));

logger.use(createContextHook(store));

// --- Express app ---
const app = express();

// 1. HTTP request logging (attaches req.log and req.requestId)
app.use(expressLogger({ logger }));

// 2. Wrap request in context scope so downstream logs include requestId
app.use((req, _res, next) => {
  store.run({ requestId: req.requestId }, () => next());
});

// 3. Routes — use req.log for request-scoped logging
app.post('/api/users', (req, res) => {
  // After auth, add userId to context
  store.set({ userId: req.body.userId });

  req.log.info('creating user');
  // All logs within this request now include { requestId, userId }

  res.status(201).json({ ok: true });
});

// 4. Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.warn('shutdown signal received', { signal });
  await logger.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)));
process.on('SIGINT', () => shutdown('SIGINT').catch(() => process.exit(1)));

app.listen(3000, () => logger.info('server started', { port: 3000 }));
```

## Hook execution order

Hooks run in registration order. The setup above produces:

1. `@ligelog/redact` — masks PII fields in the record
2. `@ligelog/context` — injects `requestId`, `userId` from AsyncLocalStorage
3. Core serializer — converts to NDJSON

This order matters: redact runs first so context-injected fields like `requestId` are **not** accidentally redacted.

## Adding development pretty output

```ts
import { PrettyTransport } from '@ligelog/pretty';

const isDev = process.env.NODE_ENV !== 'production';

const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  transports: isDev
    ? [new PrettyTransport()]
    : [new FileTransport({ path: './logs/app.log' })],
});
```

## Example log output

```json
{"level":"info","lvl":30,"time":1713100800000,"msg":"request completed","requestId":"f47ac10b-58cc","userId":42,"req":{"method":"POST","url":"/api/users","headers":{"authorization":"[REDACTED]"}},"res":{"statusCode":201},"duration":12.3}
```
