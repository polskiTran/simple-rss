import { loadConfig } from './config.js'
import { createLogger } from './logger.js'
import { startService, type RunningService } from './server.js'

/**
 * Container entrypoint. Everything interesting lives in `startService`; this
 * file only turns the process environment into configuration and translates
 * platform signals into a graceful stop.
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger({ level: config.logLevel })

  const service = await startService({ config, logger })

  installSignalHandlers(service)

  // Monitor fatal errors without replacing Node's default handler. The
  // process must still exit non-zero: after an uncaught failure, continuing
  // to serve with readiness open would claim potentially corrupted state is
  // healthy.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    const event =
      origin === 'unhandledRejection'
        ? 'process.unhandled_rejection'
        : 'process.uncaught_exception'
    logger.error(event, { error })
  })
}

/**
 * A platform replacing this container sends SIGTERM and then SIGKILL. A second
 * signal means the operator is impatient, so it stops waiting for the drain.
 */
function installSignalHandlers(service: RunningService): void {
  let stopping = false

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) {
        service.logger.warn('process.stop_repeated', { signal })
        process.exit(1)
      }
      stopping = true
      service.logger.info('process.signal_received', { signal })

      service.stop().then(
        () => process.exit(0),
        (error: unknown) => {
          service.logger.error('process.stop_failed', { error })
          process.exit(1)
        },
      )
    })
  }
}

main().catch((error: unknown) => {
  // Configuration is read before a logger exists, so this is the one place
  // that writes an unstructured line.
  console.error('simple-rss failed to start:', error)
  process.exitCode = 1
})
