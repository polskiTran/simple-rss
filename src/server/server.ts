import { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { createService, type Service, type ServiceOptions } from './service.js'

export interface StartOptions extends ServiceOptions {
  /** Overrides `config.port`. Tests pass 0 for any free port; `config.ts` still refuses 0 from a host. */
  readonly port?: number
}

/** A listening service. `stop()` is the only way down: it drains before closing the database. */
export interface RunningService extends Omit<Service, 'beginShutdown' | 'close'> {
  /** The port actually bound, which differs from the request when it was 0. */
  readonly port: number
  /** Origin a client can call, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
  /** Stops accepting connections, drains in-flight work, closes the database. */
  stop(): Promise<void>
}

const IDLE_SWEEP_MS = 20

export async function startService(options: StartOptions): Promise<RunningService> {
  const service = createService(options)
  const { server, port } = await listen(service.app, options.port ?? options.config.port)

  service.logger.info('server.started', { port, dataDir: options.config.dataDir })

  let stopped: Promise<void> | undefined

  return {
    app: service.app,
    config: service.config,
    logger: service.logger,
    clock: service.clock,
    readiness: service.readiness,
    retrieval: service.retrieval,
    get database() {
      return service.database
    },
    get settings() {
      return service.settings
    },
    get scheduler() {
      return service.scheduler
    },
    port,
    url: `http://127.0.0.1:${port}`,
    stop() {
      stopped ??= shutdown(server, service, options.config.shutdownGraceMs)
      return stopped
    },
  }
}

interface ListeningServer {
  readonly server: Server
  readonly port: number
}

/** `serve` defaults to Node's HTTP/1 server when no custom server factory is supplied. */
function listen(app: Service['app'], port: number): Promise<ListeningServer> {
  const { promise, resolve, reject } = Promise.withResolvers<ListeningServer>()
  const candidate = serve({ fetch: app.fetch, port }, (address) => {
    if (candidate instanceof Server) {
      resolve({ server: candidate, port: address.port })
    } else {
      candidate.close()
      reject(new Error('Hono created an unexpected HTTP/2 server'))
    }
  })
  candidate.once('error', reject)
  return promise
}

/**
 * Refuse new connections, let in-flight requests finish, then close the
 * database so no request observes a closed handle. Whatever outlives the
 * grace period is cut off — a platform that sent SIGTERM sends SIGKILL next.
 */
async function shutdown(server: Server, service: Service, graceMs: number): Promise<void> {
  service.logger.info('server.stopping', { graceMs })

  const drained = new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      service.logger.warn('server.stop_forced', { graceMs })
      server.closeAllConnections()
    }, graceMs)
    forceTimer.unref()

    // A keep-alive socket goes idle only after its response flushes; a single
    // sweep would miss connections still writing and wait out the full grace.
    const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS)
    sweep.unref()

    server.close(() => {
      clearTimeout(forceTimer)
      clearInterval(sweep)
      resolve()
    })
    server.closeIdleConnections()
  })
  await service.beginShutdown()
  await drained

  service.close()
  service.logger.info('server.stopped')
}
