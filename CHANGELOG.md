# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-08

### Breaking Changes

- Migrated to pnpm workspaces monorepo structure.
- `createSentryHook` has been moved to the `@ligelog/sentry` package. Install it separately: `npm install @ligelog/sentry`.
- `SentryHookOptions` and `SentryLike` types are now exported from `@ligelog/sentry` instead of `ligelog`.

### Changed

- `Logger.flush()` now waits for queue drain and transport-level `flush()` hooks.
- `logger.child()` now shares the same internal async queue with the parent.
- `onAfterWrite` hooks now run after enqueue, matching documented behavior.
- README now documents a clearer "when to choose / when not to choose" positioning.
- Serializer now escapes U+2028/U+2029 and hardens edge-case output behavior.
- `AsyncQueue` capacity is now configurable via `queueSize` and `drain()` now resolves via queue completion callbacks (no microtask polling loop).

### Fixed

- `Logger.emit` now reads from `ctx.record` instead of the original local `record` variable when serializing and dispatching to transports. Previously, an `onBeforeWrite` hook that returned a new record object via the immutable update pattern (e.g. `{ ...ctx, record: maskPii(ctx.record) }`) had its replacement silently discarded, causing PII-masking and other record-rewriting hooks to be no-ops. Hooks that mutated `ctx.record` in place were unaffected. Also shipped as `ligelog@0.1.1` on the 0.1.x line.
- `FileTransport.flush()` no longer waits forever when no drain is pending.
- Hook exceptions are isolated so logger calls do not crash application code.

### Benchmarks

- `bench/index.js` now includes side-by-side ligelog vs pino output with configurable run parameters.
- `npm run bench:compare` script alias for standardized benchmark runs.

### Documentation

- Added `docs/architecture.md` with concise core flow and reliability model.
- Added `docs/benchmarks.md` with reproducible benchmark guidance.
- Added `docs/recipes/sentry.md` and `docs/recipes/production-shutdown.md`.

### Tests

- Added `tests/queue.test.ts` for queue drain and back-pressure behavior.
- Added `tests/file-transport.test.ts` for file transport directory creation and non-hanging flush.
- Added serializer and queue edge-case coverage for new hardening behavior.

### Features

- Added `Logger.close()` for graceful shutdown (`flush` + transport `close`).
- Added issue templates and a pull request template for reproducible reports.
- Added `Logger.getWriteErrors()` for transport failure observability.

### New Packages

- **`@ligelog/caller`** — Hook that auto-attaches caller file, line, and function name to log records via `Error.captureStackTrace`. Supports `minLevel` filtering and `pathStyle` options (`basename` / `full` / `relative`).
- **`@ligelog/catch`** — Higher-order functions (`catchWith`, `catchAsync`) that wrap sync/async functions with automatic error logging. Inspired by Loguru's `@logger.catch` decorator.
- **`@ligelog/pretty`** — Colorized, human-readable console transport for development. Loguru-inspired output format with ANSI codes (zero deps), `NO_COLOR` support, and `@ligelog/caller` integration.
- **`@ligelog/rotate`** — File rotation transport with size-based and time-based triggers, configurable retention (`maxFiles`), and `timestamp` / `numeric` naming schemes.

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
