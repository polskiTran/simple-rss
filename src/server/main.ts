import { loadConfig } from './config.js'
import { createLogger, errorForLog } from './logger.js'
import { startService, type RunningService } from './server.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger({ level: config.logLevel })

  const service = await startService({ config, logger })

  installSignalHandlers(service)

  // Monitors without replacing Node's default handler: the process must still
  // exit non-zero rather than serve potentially corrupted state as healthy.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    const event = origin === 'unhandledRejection' ? 'process.unhandled_rejection' : 'process.uncaught_exception'
    logger.error(event, { error })
  })
}

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
        (cause: unknown) => {
          service.logger.error('process.stop_failed', { error: errorForLog(cause) })
          process.exit(1)
        },
      )
    })
  }
}

main().catch((cause: unknown) => {
  console.error('simple-rss failed to start:', cause)
  process.exitCode = 1
})
