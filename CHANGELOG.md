# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-04-08

### Fixed

- `Logger.emit` now reads from `ctx.record` instead of the original local `record` variable when serializing and dispatching to transports. Previously, an `onBeforeWrite` hook that returned a new record object via the immutable update pattern (e.g. `{ ...ctx, record: maskPii(ctx.record) }`) had its replacement silently discarded, causing PII-masking and other record-rewriting hooks to be no-ops. Hooks that mutated `ctx.record` in place were unaffected.

## [0.1.0] - 2024-01-01

### Added

- Core `Logger` class with `debug`, `info`, `warn`, `error`, `fatal` methods
- `child(ctx)` for scoped loggers that inherit transports and hooks
- `use(hooks)` chainable hook registration
- Three-phase hook pipeline: `onBeforeWrite` → `onSerialize` → `onAfterWrite`
- Custom NDJSON serializer — no `JSON.stringify` on the hot path
- Non-blocking async ring-buffer queue via `queueMicrotask`
- `StdoutTransport` — writes to `process.stdout`
- `FileTransport` — appends to a file via `fs.WriteStream`
- `createSentryHook` — Sentry integration via `onAfterWrite` hook
- Dual ESM + CJS build via `tsup`
- Full TypeScript types exported
- Vitest test suite
- GitHub Actions CI (Node 18 / 20 / 22) and npm release workflow
