import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createService, type Service, type ServiceOptions } from './service.js'

export interface StartOptions extends ServiceOptions {
  /**
   * Overrides `config.port`. Tests pass 0 to take any free port; the platform
   * contract in `config.ts` still refuses 0, because a host that injects it
   * has misconfigured the service.
   */
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

/** How often the drain looks for keep-alive sockets that have gone idle. */
const IDLE_SWEEP_MS = 20

/**
 * Starts the complete service on a real socket. Used by `main.ts` and by the
 * test harness, so tests exercise the same wiring that production does.
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
    get database() {
      return service.database
    },
    get settings() {
      return service.settings
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
 * `serve` can create an HTTP/2 server too, but this service never asks it to,
 * so the result is narrowed to `http.Server` — the connection-draining methods
 * the shutdown below relies on exist only there.
 */
function listen(app: Service['app'], port: number): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, () => resolve(server as Server)) as Server
    server.once('error', reject)
  })
}

/**
 * Graceful shutdown: refuse new connections, let in-flight requests finish,
 * and only then close the database so no request observes a closed handle.
 *
 * Idle keep-alive connections are closed immediately — they hold the server
 * open but are not doing work. Anything still running after the grace period
 * is cut off, because a platform that sent SIGTERM will send SIGKILL next.
 */
async function shutdown(server: Server, service: Service, graceMs: number): Promise<void> {
  service.logger.info('server.stopping', { graceMs })

  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      service.logger.warn('server.stop_forced', { graceMs })
      server.closeAllConnections()
    }, graceMs)
    forceTimer.unref()

    // A keep-alive socket becomes idle only once its response has flushed, so
    // sweeping repeatedly is what actually ends the drain. Sweeping once would
    // miss every connection that was still writing at this instant and make
    // shutdown wait out the full grace period.
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
