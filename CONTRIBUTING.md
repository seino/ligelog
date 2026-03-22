# Contributing to ligelog

Thank you for your interest in contributing to ligelog!

## Development Setup

```sh
git clone https://github.com/seino/ligelog.git
cd ligelog
pnpm install
pnpm run build
pnpm run test
```

**Requirements:** Node.js >= 18, pnpm

## Project Structure

```
ligelog/
├── packages/
│   ├── core/       # Core logger (published as `ligelog`)
│   ├── caller/     # @ligelog/caller — caller info hook
│   ├── catch/      # @ligelog/catch — error wrapping HOFs
│   ├── pretty/     # @ligelog/pretty — colorized dev transport
│   ├── rotate/     # @ligelog/rotate — file rotation transport
│   └── sentry/     # @ligelog/sentry — Sentry integration hook
├── bench/          # Benchmark scripts
├── docs/           # Architecture and recipe documentation
└── pnpm-workspace.yaml
```

## Development Workflow

1. Create a branch from `main`: `feat/`, `fix/`, `refactor/`
2. Make changes in the relevant package(s)
3. Run lint: `pnpm run lint`
4. Run tests: `pnpm run test`
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) format (in English)
6. Open a pull request against `main`

## Commit Messages

Format: `type: description`

| Type | Use for |
|------|---------|
| `feat` | New features |
| `fix` | Bug fixes |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation updates |
| `test` | Test additions or changes |
| `chore` | Build, CI, tooling changes |

Examples:

```
feat: add onHookError callback for hook failure observability
fix: replace non-null assertion with fallback in currentLevelName
test: add AsyncQueue FIFO ordering tests
docs: add README for @ligelog/caller
```

## Running Benchmarks

```sh
pnpm run bench           # Run benchmark suite
pnpm run bench:compare   # Compare against Pino
```

Optional tuning:

```sh
BENCH_ITERATIONS=500000 BENCH_WARMUP=50000 pnpm run bench:compare
```

## Adding a New Package

1. Create `packages/<name>/` with `src/index.ts`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`
2. Add to `pnpm-workspace.yaml` (already covered by `packages/*` glob)
3. Add to root `tsconfig.json` references
4. Add README.md and LICENSE
5. Document in the root README ecosystem table

## Code Style

- TypeScript strict mode (`strict: true`)
- Zero `any` in production code (use `unknown`)
- `as` casts only when justified
- Functions under 30 lines, nesting under 3 levels
- Descriptive names — no abbreviations

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
