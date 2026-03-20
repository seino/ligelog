# Benchmarks

This project includes a built-in `ligelog` vs `pino` micro-benchmark.

## Run

```sh
npm run bench:compare
```

Optional tuning:

```sh
BENCH_ITERATIONS=500000 BENCH_WARMUP=50000 BENCH_FLUSH_EVERY=1000 npm run bench:compare
```

## What is measured

- Logger API call + serialization + dispatch overhead
- No real I/O (null destination/sink)
- Side-by-side numbers for:
  - `info (string only)`
  - `info + 3 fields`
  - `error + Error obj`

## Output fields

- `ligelog ops/sec`, `pino ops/sec`
- `ligelog ns/op`, `pino ns/op`
- `ratio (ligelog/pino)`
- `dropped` (queue saturation indicator)

## Interpretation

- Use results as directional signals, not absolute truth.
- A fast micro-benchmark does not guarantee production performance.
- Always validate with your transport mix and workload profile.
- Track results over time to catch regressions after code changes.

## Reproducibility checklist

- Record Node version and OS.
- Use consistent CPU/power settings.
- Keep iteration/warmup values fixed when comparing commits.
- Include dropped count in any reported comparison.

## Report template (copy/paste)

```md
Node:
OS:
CPU:
Command:
Iterations / warmup / flushEvery:

Results:
- info (string only):
- info + 3 fields:
- error + Error obj:

Dropped:
Notes:
```
