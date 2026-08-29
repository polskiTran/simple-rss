import type { ReaderWorkerControl, ReaderWorkerDirective } from '../../src/server/reader/reader-extractor.js'

export class ReaderWorkerFixtures implements ReaderWorkerControl {
  #next: ReaderWorkerDirective | undefined
  #submitted = 0
  #cancelled = 0
  #submission = Promise.withResolvers<void>()
  #cancellation = Promise.withResolvers<void>()

  holdNext() {
    const held = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    const entered = waitForValue(held, 1)
    this.#next = { kind: 'hold', state: held.buffer }
    return {
      entered,
      release: () => {
        Atomics.store(held, 0, 2)
        Atomics.notify(held, 0)
      },
    }
  }

  crashNext(): void {
    this.#next = { kind: 'crash' }
  }

  nextDirective(): ReaderWorkerDirective | undefined {
    this.#submitted += 1
    this.#submission.resolve()
    this.#submission = Promise.withResolvers<void>()
    const directive = this.#next
    this.#next = undefined
    return directive
  }

  taskCancelled(): void {
    this.#cancelled += 1
    this.#cancellation.resolve()
    this.#cancellation = Promise.withResolvers<void>()
  }

  async waitForSubmittedTasks(expected: number): Promise<void> {
    while (this.#submitted < expected) await this.#submission.promise
  }

  async waitForCancelledTasks(expected: number): Promise<void> {
    while (this.#cancelled < expected) await this.#cancellation.promise
  }
  submittedTasks(): number {
    return this.#submitted
  }

  cancelledTasks(): number {
    return this.#cancelled
  }
}

async function waitForValue(state: Int32Array, expected: number): Promise<void> {
  for (;;) {
    const current = Atomics.load(state, 0)
    if (current === expected) return
    const waiting = Atomics.waitAsync(state, 0, current)
    if (waiting.async) await waiting.value
  }
}
