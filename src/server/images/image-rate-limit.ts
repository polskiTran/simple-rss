import type { Clock } from '../clock.js'

export const IMAGE_WINDOW_MS = 60_000

export const IMAGE_REQUESTS_PER_WINDOW = 240

const SWEEP_THRESHOLD = 256

export type ImageRateVerdict = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number }

export class ImageRateLimiter {
  readonly #clock: Clock
  readonly #windows = new Map<string, { startedAt: number; count: number }>()

  constructor(clock: Clock) {
    this.#clock = clock
  }

  allow(client: string): ImageRateVerdict {
    const now = this.#clock.now().getTime()
    this.#sweep(now)

    const window = this.#windows.get(client)
    if (!window || now - window.startedAt >= IMAGE_WINDOW_MS) {
      this.#windows.set(client, { startedAt: now, count: 1 })
      return { allowed: true }
    }

    if (window.count >= IMAGE_REQUESTS_PER_WINDOW) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + IMAGE_WINDOW_MS - now) / 1000)),
      }
    }

    window.count += 1
    return { allowed: true }
  }

  #sweep(now: number): void {
    if (this.#windows.size < SWEEP_THRESHOLD) return
    for (const [client, window] of this.#windows) {
      if (now - window.startedAt >= IMAGE_WINDOW_MS) this.#windows.delete(client)
    }
  }
}
