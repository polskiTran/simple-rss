import { randomUUID } from 'node:crypto'
import { BroadcastChannel } from 'node:worker_threads'
import { z } from 'zod'
import type { LogRecord } from '../../src/server/logger.js'

/**
 * Drives the fixture worker in `reader-worker-fixtures.worker.ts` over a
 * `BroadcastChannel` private to this instance. Arming is a handshake: the
 * worker announces `ready` once on boot, a directive answers with `armed`
 * before the returned promise resolves, so a request issued after arming
 * deterministically meets the directive.
 */
export class ReaderWorkerFixtures {
  /** Worker module for the service under test, via the harness `readerWorkerUrl` option. */
  readonly url: URL
  readonly #channel: BroadcastChannel
  readonly #ready = Promise.withResolvers<void>()
  readonly #armed: (() => void)[] = []

  constructor() {
    const channel = `reader-worker-fixture-${randomUUID()}`
    this.url = new URL(`./reader-worker-fixtures.worker.ts?channel=${channel}`, import.meta.url)
    this.#channel = new BroadcastChannel(channel)
    this.#channel.unref()
    this.#channel.onmessage = (event) => {
      const message = fixtureAckSchema.parse((event as { data: unknown }).data)
      if (message.kind === 'ready') this.#ready.resolve()
      if (message.kind === 'armed') this.#armed.shift()?.()
    }
  }

  /**
   * Arms the worker to block inside its next task until `release()`. `entered`
   * resolves once the worker thread is parked in `Atomics.wait`.
   */
  async holdNext(): Promise<{ entered: Promise<void>; release: () => void }> {
    const held = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    const entered = waitForValue(held, 1)
    await this.#arm({ kind: 'hold', state: held.buffer })
    return {
      entered,
      release: () => {
        Atomics.store(held, 0, 2)
        Atomics.notify(held, 0)
      },
    }
  }

  /** Arms the worker to throw on its next task, killing the worker thread. */
  async crashNext(): Promise<void> {
    await this.#arm({ kind: 'crash' })
  }

  async #arm(directive: ReaderWorkerFixtureDirective): Promise<void> {
    await this.#ready.promise
    const armed = Promise.withResolvers<void>()
    this.#armed.push(armed.resolve)
    this.#channel.postMessage(directive)
    await armed.promise
  }
}

export const readerWorkerFixtureDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hold'), state: z.instanceof(SharedArrayBuffer) }),
  z.object({ kind: z.literal('crash') }),
])

export type ReaderWorkerFixtureDirective = z.infer<typeof readerWorkerFixtureDirectiveSchema>

const fixtureAckSchema = z.object({ kind: z.enum(['ready', 'armed']) })

/** Extraction tasks the service's extractor has accepted, including still-queued ones. */
export function queuedExtractions(logs: readonly LogRecord[]): number {
  return logs.filter((record) => record.message === 'reader.extraction_queued').length
}

/** Extraction tasks the service's extractor settled as cancelled. */
export function cancelledExtractions(logs: readonly LogRecord[]): number {
  return logs.filter((record) => record.message === 'reader.extraction_cancelled').length
}

async function waitForValue(state: Int32Array, expected: number): Promise<void> {
  for (;;) {
    const current = Atomics.load(state, 0)
    if (current === expected) return
    const waiting = Atomics.waitAsync(state, 0, current)
    if (waiting.async) await waiting.value
  }
}
