/**
 * @file bench/index.js
 * Fair-ish benchmark comparing ligelog and pino.
 *
 * Run with:
 *   node --expose-gc bench/index.js
 *
 * Notes:
 * - Both loggers write to a null sink (no real I/O).
 * - ligelog queue is periodically flushed to avoid artificial drops.
 * - This is still a micro-benchmark; always validate in production-like load.
 */

import pino from 'pino'
import { createLogger } from '../packages/core/dist/index.js'

class NullTransport {
  write(_line, _record) {}
}

const nullDestination = { write(_chunk) {} }

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 200_000)
const WARMUP = Number(process.env.BENCH_WARMUP ?? 20_000)
const FLUSH_EVERY = Number(process.env.BENCH_FLUSH_EVERY ?? 2_000)

async function maybeFlush(logger, i) {
  if (logger && i > 0 && i % FLUSH_EVERY === 0) {
    await logger.flush()
  }
}

async function runCase({ name, ligelogFn, pinoFn }) {
  const ligelog = createLogger({
    level: 'info',
    context: { app: 'bench', env: 'production' },
    transports: [new NullTransport()],
  })
  const pinoLogger = pino(
    { level: 'info', base: { app: 'bench', env: 'production' }, timestamp: pino.stdTimeFunctions.epochTime },
    nullDestination,
  )

  for (let i = 0; i < WARMUP; i++) {
    ligelogFn(ligelog, i)
    pinoFn(pinoLogger, i)
    await maybeFlush(ligelog, i)
  }
  await ligelog.flush()
  if (typeof global.gc === 'function') global.gc()

  const lStart = process.hrtime.bigint()
  for (let i = 0; i < ITERATIONS; i++) {
    ligelogFn(ligelog, i)
    await maybeFlush(ligelog, i)
  }
  await ligelog.flush()
  const lElapsed = Number(process.hrtime.bigint() - lStart)

  const pStart = process.hrtime.bigint()
  for (let i = 0; i < ITERATIONS; i++) {
    pinoFn(pinoLogger, i)
  }
  const pElapsed = Number(process.hrtime.bigint() - pStart)

  const ligelogOps = Math.round((ITERATIONS / lElapsed) * 1e9)
  const pinoOps = Math.round((ITERATIONS / pElapsed) * 1e9)
  const ligelogNs = (lElapsed / ITERATIONS).toFixed(1)
  const pinoNs = (pElapsed / ITERATIONS).toFixed(1)
  const ratio = (ligelogOps / pinoOps).toFixed(2)

  return {
    name,
    ligelogOps,
    pinoOps,
    ligelogNs,
    pinoNs,
    ratio,
    dropped: ligelog.getDropped(),
  }
}

const cases = [
  {
    name: 'info (string only)',
    ligelogFn: logger => logger.info('benchmark iteration'),
    pinoFn: logger => logger.info('benchmark iteration'),
  },
  {
    name: 'info + 3 fields',
    ligelogFn: (logger, i) =>
      logger.info('request', { requestId: `req-${i}`, statusCode: 200, latencyMs: 42 }),
    pinoFn: (logger, i) =>
      logger.info({ requestId: `req-${i}`, statusCode: 200, latencyMs: 42 }, 'request'),
  },
  {
    name: 'error + Error obj',
    ligelogFn: (logger, i) =>
      logger.error('unhandled', { error: new Error(`err-${i}`), requestId: `req-${i}` }),
    pinoFn: (logger, i) =>
      logger.error({ error: new Error(`err-${i}`), requestId: `req-${i}` }, 'unhandled'),
  },
]

console.log('\n=== ligelog vs pino benchmark ===\n')
console.log(`iterations=${ITERATIONS}, warmup=${WARMUP}, flushEvery=${FLUSH_EVERY}\n`)
console.log('| Case | ligelog ops/sec | pino ops/sec | ligelog ns/op | pino ns/op | ratio (ligelog/pino) | dropped |')
console.log('|------|------------------|--------------|---------------|------------|----------------------|---------|')

for (const c of cases) {
  const r = await runCase(c)
  console.log(
    `| ${r.name} | ${r.ligelogOps} | ${r.pinoOps} | ${r.ligelogNs} | ${r.pinoNs} | ${r.ratio} | ${r.dropped} |`,
  )
}

console.log('\nInterpretation tips:')
console.log('- ratio > 1.00: ligelog faster in this micro-benchmark')
console.log('- dropped > 0: ligelog back-pressure occurred; reduce BENCH_FLUSH_EVERY')
console.log('- treat results as directional; validate with production transports\n')
