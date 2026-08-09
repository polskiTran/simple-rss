import type { Clock } from '../clock.js'

/** How long one client's image requests count against its allowance. */
export const IMAGE_WINDOW_MS = 60_000

/**
 * Image requests one client address may make inside the window. Generous
 * enough for a Digest and an image-heavy article to load without friction —
 * every image is one request — while bounding what the proxy can be made to
 * ask publishers on someone's behalf.
 */
export const IMAGE_REQUESTS_PER_WINDOW = 240

/**
 * Map size at which expired windows are swept. Far above what one Owner's
 * devices produce, so the sweep only ever runs under address-spoofing noise.
 */
const SWEEP_THRESHOLD = 256

export type ImageRateVerdict = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number }

/**
 * A fixed window per client address. Unlike login limiting there is no
 * failure to distinguish from success: every proxied image costs an upstream
 * request, so every one counts.
 */
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

  /** Expired windows are dropped so strangers cannot grow the map forever. */
  #sweep(now: number): void {
    if (this.#windows.size < SWEEP_THRESHOLD) return
    for (const [client, window] of this.#windows) {
      if (now - window.startedAt >= IMAGE_WINDOW_MS) this.#windows.delete(client)
    }
  }
}
