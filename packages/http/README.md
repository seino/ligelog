# @ligelog/http

HTTP request logging middleware for [ligelog](https://github.com/seino/ligelog) — supports Express and Hono.

## Install

```sh
npm install @ligelog/http ligelog
```

## Usage

### Express

```ts
import { createLogger } from 'ligelog';
import { expressLogger } from '@ligelog/http/express';

const logger = createLogger();
app.use(expressLogger({ logger }));

app.get('/api/users', (req, res) => {
  req.log.info('handling request');
  res.json({ users: [] });
});
```

### Hono

```ts
import { createLogger } from 'ligelog';
import { honoLogger } from '@ligelog/http/hono';
import { Hono } from 'hono';

const logger = createLogger();
const app = new Hono();
app.use(honoLogger({ logger }));

app.get('/api/users', (c) => {
  c.get('log').info('handling request');
  return c.json({ users: [] });
});
```

## Middleware ordering

> **Important:** The logging middleware registers a `finish` event listener (Express) or wraps `next()` (Hono) to capture response status and duration. Middleware and error handler ordering in your framework affects what gets logged.

**Express:**

- Place `expressLogger()` **before** your routes so all responses are captured.
- If you have a custom error handler, place it **after** your routes. The logger still fires on `res.on('finish')`, but the logged status depends on what the error handler sends.

**Hono:**

- Place `honoLogger()` **before** your routes.
- If a downstream handler throws, the middleware catches the error, logs the response, and re-throws.

**Recommendation:** Run a smoke test with your actual middleware stack before deploying to production. Middleware ordering varies across applications and may produce unexpected log timing or status codes.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logger` | `LoggerLike` | **(required)** | The ligelog instance |
| `level` | `string` | `'info'` | Log level for 2xx/3xx responses |
| `clientErrorLevel` | `string` | `'warn'` | Log level for 4xx responses |
| `serverErrorLevel` | `string` | `'error'` | Log level for 5xx responses |
| `requestIdHeader` | `string` | `'x-request-id'` | Header to read request ID from |
| `generateRequestId` | `() => string` | `crypto.randomUUID()` | Request ID generator |
| `redactHeaders` | `string[]` | `['authorization', 'cookie', 'set-cookie']` | Headers to redact |
| `skip` | `(req, res) => boolean` | `undefined` | Skip logging for matched requests |
| `serializers.req` | `(req) => object` | built-in | Custom request serializer |
| `serializers.res` | `(res) => object` | built-in | Custom response serializer |

## License

MIT
