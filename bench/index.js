/**
 * @file bench/index.js
 * Multi-logger benchmark: ligelog vs pino vs winston vs bunyan.
 *
 * Run with:
 *   node --expose-gc bench/index.js
 *
 * Notes:
 * - All loggers write to a null sink (no real I/O).
 * - ligelog queue is periodically flushed to avoid artificial drops.
 * - pino is designed for async I/O; running in sync mode is unfavorable to pino.
 * - winston uses a null stream transport (sync).
 * - bunyan uses a null stream (sync).
 * - This is a micro-benchmark; always validate in production-like load.
 */

import pino from 'pino'
import winston from 'winston'
import bunyan from 'bunyan'
import { Writable } from 'node:stream'
import { createLogger } from '../packages/core/dist/index.js'

// ---------------------------------------------------------------------------
// Null sinks
// ---------------------------------------------------------------------------

class NullTransport {
  write(_line, _record) {}
}

const nullDestination = { write(_chunk) {} }

const nullStream = new Writable({
  write(_chunk, _encoding, callback) {
    callback()
  },
})

// ---------------------------------------------------------------------------
// Logger factories
// ---------------------------------------------------------------------------

function createLigelog() {
  return createLogger({
    level: 'info',
    context: { app: 'bench', env: 'production' },
    transports: [new NullTransport()],
  })
}

function createPinoLogger() {
  return pino(
    {
      level: 'info',
      base: { app: 'bench', env: 'production' },
      timestamp: pino.stdTimeFunctions.epochTime,
    },
    nullDestination,
  )
}

function createWinstonLogger() {
  return winston.createLogger({
    level: 'info',
    defaultMeta: { app: 'bench', env: 'production' },
    transports: [new winston.transports.Stream({ stream: nullStream })],
  })
}

function createBunyanLogger() {
  return bunyan.createLogger({
    name: 'bench',
    app: 'bench',
    env: 'production',
    streams: [{ stream: nullStream }],
  })
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 200_000)
const WARMUP = Number(process.env.BENCH_WARMUP ?? 20_000)
const FLUSH_EVERY = Number(process.env.BENCH_FLUSH_EVERY ?? 2_000)

async function maybeFlush(logger, i) {
  if (logger && typeof logger.flush === 'function' && i > 0 && i % FLUSH_EVERY === 0) {
    await logger.flush()
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string} params.name
 * @param {Record<string, (logger: unknown, i: number) => void>} params.fns
 *   Keyed by logger name, each value is the function to call per iteration.
 * @param {Record<string, () => unknown>} params.factories
 *   Keyed by logger name, each value creates a fresh logger.
 * @param {Record<string, string>} params.notes
 *   Fairness notes per logger.
 */
async function runCase({ name, fns, factories, notes }) {
  const loggers = {}
  for (const [loggerName, factory] of Object.entries(factories)) {
    loggers[loggerName] = factory()
  }

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    for (const [loggerName, fn] of Object.entries(fns)) {
      fn(loggers[loggerName], i)
    }
    await maybeFlush(loggers.ligelog, i)
  }
  if (loggers.ligelog?.flush) await loggers.ligelog.flush()
  if (typeof global.gc === 'function') global.gc()

  // Measure each logger
  const results = {}
  for (const [loggerName, fn] of Object.entries(fns)) {
    // Re-create logger for isolation
    loggers[loggerName] = factories[loggerName]()

    if (typeof global.gc === 'function') global.gc()

    const start = process.hrtime.bigint()
    for (let i = 0; i < ITERATIONS; i++) {
      fn(loggers[loggerName], i)
      if (loggerName === 'ligelog') await maybeFlush(loggers[loggerName], i)
    }
    if (loggerName === 'ligelog' && loggers[loggerName]?.flush) {
      await loggers[loggerName].flush()
    }
    const elapsed = Number(process.hrtime.bigint() - start)

    const ops = Math.round((ITERATIONS / elapsed) * 1e9)
    const ns = (elapsed / ITERATIONS).toFixed(1)
    const dropped = loggerName === 'ligelog' ? loggers[loggerName].getDropped() : '-'

    results[loggerName] = { ops, ns, dropped, note: notes[loggerName] || '' }
  }

  return { name, results }
}

// ---------------------------------------------------------------------------
// Benchmark cases
// ---------------------------------------------------------------------------

const LOGGER_NAMES = ['ligelog', 'pino', 'winston', 'bunyan']

const FACTORIES = {
  ligelog: createLigelog,
  pino: createPinoLogger,
  winston: createWinstonLogger,
  bunyan: createBunyanLogger,
}

const NOTES = {
  ligelog: 'sync + flush',
  pino: 'sync sink (非推奨)',
  winston: 'stream transport',
  bunyan: 'stream',
}

const cases = [
  {
    name: 'info (string only)',
    fns: {
      ligelog: (logger) => logger.info('benchmark iteration'),
      pino: (logger) => logger.info('benchmark iteration'),
      winston: (logger) => logger.info('benchmark iteration'),
      bunyan: (logger) => logger.info('benchmark iteration'),
    },
  },
  {
    name: 'info + 3 fields',
    fns: {
      ligelog: (logger, i) =>
        logger.info('request', { requestId: `req-${i}`, statusCode: 200, latencyMs: 42 }),
      pino: (logger, i) =>
        logger.info({ requestId: `req-${i}`, statusCode: 200, latencyMs: 42 }, 'request'),
      winston: (logger, i) =>
        logger.info('request', { requestId: `req-${i}`, statusCode: 200, latencyMs: 42 }),
      bunyan: (logger, i) =>
        logger.info({ requestId: `req-${i}`, statusCode: 200, latencyMs: 42 }, 'request'),
    },
  },
  {
    name: 'error + Error obj',
    fns: {
      ligelog: (logger, i) =>
        logger.error('unhandled', { error: new Error(`err-${i}`), requestId: `req-${i}` }),
      pino: (logger, i) =>
        logger.error({ error: new Error(`err-${i}`), requestId: `req-${i}` }, 'unhandled'),
      winston: (logger, i) =>
        logger.error('unhandled', { error: new Error(`err-${i}`), requestId: `req-${i}` }),
      bunyan: (logger, i) =>
        logger.error({ error: new Error(`err-${i}`), requestId: `req-${i}` }, 'unhandled'),
    },
  },
  {
    name: 'deep nested (5 levels)',
    fns: {
      ligelog: (logger) =>
        logger.info('deep', {
          a: { b: { c: { d: { e: { value: 42, label: 'deep' } } } } },
        }),
      pino: (logger) =>
        logger.info(
          { a: { b: { c: { d: { e: { value: 42, label: 'deep' } } } } } },
          'deep',
        ),
      winston: (logger) =>
        logger.info('deep', {
          a: { b: { c: { d: { e: { value: 42, label: 'deep' } } } } },
        }),
      bunyan: (logger) =>
        logger.info(
          { a: { b: { c: { d: { e: { value: 42, label: 'deep' } } } } } },
          'deep',
        ),
    },
  },
  {
    name: 'child + 1 write',
    fns: {
      ligelog: (logger, i) => {
        const child = logger.child({ requestId: `req-${i}` })
        child.info('handled')
      },
      pino: (logger, i) => {
        const child = logger.child({ requestId: `req-${i}` })
        child.info('handled')
      },
      winston: (logger, i) => {
        const child = logger.child({ requestId: `req-${i}` })
        child.info('handled')
      },
      bunyan: (logger, i) => {
        const child = logger.child({ requestId: `req-${i}` })
        child.info('handled')
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\n=== ligelog vs pino vs winston vs bunyan benchmark ===\n')
console.log(`iterations=${ITERATIONS}, warmup=${WARMUP}, flushEvery=${FLUSH_EVERY}\n`)

// Table header
const headerCols = ['Case']
for (const name of LOGGER_NAMES) {
  headerCols.push(`${name} ops/s`)
  headerCols.push(`${name} ns/op`)
}
headerCols.push('dropped(ligelog)')
console.log(`| ${headerCols.join(' | ')} |`)
console.log(`|${headerCols.map(() => '------').join('|')}|`)

for (const c of cases) {
  const r = await runCase({
    name: c.name,
    fns: c.fns,
    factories: FACTORIES,
    notes: NOTES,
  })

  const cols = [r.name]
  for (const name of LOGGER_NAMES) {
    const d = r.results[name]
    cols.push(String(d.ops))
    cols.push(d.ns)
  }
  cols.push(String(r.results.ligelog.dropped))
  console.log(`| ${cols.join(' | ')} |`)
}

console.log('\n--- 条件注記 ---')
console.log('| Logger  | モード | 備考 |')
console.log('|---------|--------|------|')
console.log('| ligelog | sync + periodic flush | キュー溢れ時は backpressure |')
console.log('| pino    | sync destination      | pino は非同期前提の設計。同期モードは不利 |')
console.log('| winston | Stream transport       | sync stream |')
console.log('| bunyan  | stream                 | sync stream |')
console.log('')
console.log('Interpretation tips:')
console.log('- ops/s が大きいほど高速')
console.log('- ns/op が小さいほど高速')
console.log('- dropped > 0: ligelog の backpressure が発動。BENCH_FLUSH_EVERY を下げてください')
console.log('- pino の同期モードは非推奨。本番では pino.destination() を使ってください')
console.log('- micro-benchmark の結果は参考値。本番環境で検証してください\n')
