import type { Clock } from '../clock.js'
import type { IngestFeedOutcome, SubscriptionService } from './subscription-service.js'

const REFRESH_COOLDOWN_MS = 60_000

export type RefreshFeedOutcome =
  | IngestFeedOutcome
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number }

/** Coalesces concurrent refreshes and bounds deliberate repeat retrievals per Feed. */
export class FeedRefresh {
  readonly #clock: Clock
  readonly #subscriptions: SubscriptionService
  readonly #inFlight = new Map<number, Promise<IngestFeedOutcome>>()
  readonly #lastStartedAt = new Map<number, number>()

  constructor(options: { readonly clock: Clock; readonly subscriptions: SubscriptionService }) {
    this.#clock = options.clock
    this.#subscriptions = options.subscriptions
  }

  refresh(feedId: number): Promise<RefreshFeedOutcome> {
    const inFlight = this.#inFlight.get(feedId)
    if (inFlight) return inFlight

    const now = this.#clock.now().getTime()
    for (const [candidateFeedId, startedAt] of this.#lastStartedAt) {
      if (now - startedAt >= REFRESH_COOLDOWN_MS && !this.#inFlight.has(candidateFeedId)) {
        this.#lastStartedAt.delete(candidateFeedId)
      }
    }

    const lastStartedAt = this.#lastStartedAt.get(feedId)
    if (lastStartedAt !== undefined) {
      return Promise.resolve({
        kind: 'rate-limited',
        retryAfterSeconds: Math.ceil((REFRESH_COOLDOWN_MS - (now - lastStartedAt)) / 1_000),
      })
    }

    this.#lastStartedAt.set(feedId, now)
    const refresh = this.#subscriptions
      .ingest(feedId)
      .then((outcome) => {
        if (outcome.kind === 'missing') this.#lastStartedAt.delete(feedId)
        return outcome
      })
      .finally(() => this.#inFlight.delete(feedId))
    this.#inFlight.set(feedId, refresh)
    return refresh
  }
}
