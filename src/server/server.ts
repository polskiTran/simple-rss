import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createService, type Service, type ServiceOptions } from './service.js'

export interface StartOptions extends ServiceOptions {
  /** Overrides `config.port`. Tests pass 0 for any free port; `config.ts` still refuses 0 from a host. */
  readonly port?: number
}

export interface RunningService extends Service {
  /** The port actually bound, which differs from the request when it was 0. */
  readonly port: number
  /** Origin a client can call, e.g. `http://127.0.0.1:53124`. */
  readonly url: string
  /** Stops accepting connections, drains in-flight work, closes the database. */
  stop(): Promise<void>
}

const IDLE_SWEEP_MS = 20

/**
 * Starts the complete service on a real socket. The test harness uses this
 * too, so tests exercise the same wiring production does.
 */
export async function startService(options: StartOptions): Promise<RunningService> {
  const service = createService(options)
  const server = await listen(service.app, options.port ?? options.config.port)
  const port = (server.address() as AddressInfo).port

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
    close: () => service.close(),
    port,
    url: `http://127.0.0.1:${port}`,
    stop() {
      stopped ??= shutdown(server, service, options.config.shutdownGraceMs)
      return stopped
    },
  }
}

/**
 * `serve` can also create an HTTP/2 server; the result is narrowed to
 * `http.Server` because the connection-draining methods exist only there.
 */
function listen(app: Service['app'], port: number): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, () => resolve(server as Server)) as Server
    server.once('error', reject)
  })
}

/**
 * Refuse new connections, let in-flight requests finish, then close the
 * database so no request observes a closed handle. Whatever outlives the
 * grace period is cut off — a platform that sent SIGTERM sends SIGKILL next.
 */
async function shutdown(server: Server, service: Service, graceMs: number): Promise<void> {
  service.logger.info('server.stopping', { graceMs })

  await new Promise<void>((resolve) => {
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

  service.close()
  service.logger.info('server.stopped')
}
