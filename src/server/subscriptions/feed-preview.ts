import {
  CADENCE_STRIP_DAYS,
  FEED_PREVIEW_ITEMS,
  type FeedPreview as PreviewedFeed,
  type FeedPreviewResponse,
} from '../../shared/api.js'
import { dateKey, dayKeysIn } from '../calendar.js'
import type { Clock } from '../clock.js'
import { trailingDayKeys } from '../digest/cadence-window.js'
import { declaredFeeds } from '../ingestion/declared-feeds.js'
import { feedDomain } from '../ingestion/feed-window.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { RETRIEVAL_PROFILES, type Retrieval, type RetrievalBytes } from '../upstream/retrieval.js'
import type { FailedPoll } from './feed-availability.js'
import { readFeed, type FeedAnswer } from './feed-poll.js'
import { canonicalFeedUrl, subscribedFeedId } from './new-subscription.js'

/** How many of a page's Declared Feeds one preview retrieves. */
const MAX_DECLARED_FEEDS = 5

const DAY_MS = 24 * 60 * 60 * 1_000

/** A Feed document's root element, past any XML declaration, processing instructions and comments. */
const FEED_ROOT = /^\s*(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*<(?:rss|feed|rdf:RDF)[\s/>]/

export type FeedPreviewOutcome =
  | { readonly kind: 'previewed'; readonly preview: FeedPreviewResponse }
  | { readonly kind: 'invalid-url' }
  | FailedPoll

/**
 * What an address the User entered answers, summarised before anything is
 * recorded (ADR 0012). The preview reads the database only to say whether a
 * Feed is already subscribed, and never writes to it.
 */
export class FeedPreview {
  readonly #db: DrizzleDatabase
  readonly #retrieval: Retrieval
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore

  constructor(options: {
    db: DrizzleDatabase
    retrieval: Retrieval
    clock: Clock
    settings: InstallationSettingsStore
  }) {
    this.#db = options.db
    this.#retrieval = options.retrieval
    this.#clock = options.clock
    this.#settings = options.settings
  }

  /**
   * A Feed answers as itself, whatever content type serves it. A web page is
   * read for its Declared Feeds: the first five are each retrieved once, as
   * Feeds — a declared address answering with another page is left out, never
   * followed — and those that answer are summarised in page order. When the
   * page declared Feeds and none answered, the first one's failure is the answer.
   */
  async preview(enteredUrl: string, signal?: AbortSignal): Promise<FeedPreviewOutcome> {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }
    const cancellable = signal ? { signal } : {}

    const retrieved = await this.#retrieval.retrieveBytes({ url: requestedUrl, operation: 'discovery', ...cancellable })
    if (!retrieved.ok) return { kind: 'retrieval-failed', failure: retrieved }
    const now = this.#clock.now()

    if (servesFeed(retrieved)) {
      const answer = readFeed(retrieved, [requestedUrl])
      if (answer.kind !== 'parsed') return answer
      return { kind: 'previewed', preview: { kind: 'feed', feed: this.#summarise(requestedUrl, answer, now) } }
    }

    // `<link>` markup is ASCII in any charset a page plausibly declares, so UTF-8 reads it.
    const page = new TextDecoder().decode(retrieved.bytes)
    const answers = await Promise.all(
      declaredFeeds(page, retrieved.url)
        .slice(0, MAX_DECLARED_FEEDS)
        .map(async (feedUrl) => {
          const declared = await this.#retrieval.retrieveBytes({ url: feedUrl, operation: 'feed', ...cancellable })
          return { feedUrl, answer: readFeed(declared, [feedUrl]) }
        }),
    )
    const feeds = answers.flatMap(({ feedUrl, answer }) =>
      answer.kind === 'parsed' ? [this.#summarise(feedUrl, answer, now)] : [],
    )
    const [failure] = answers.flatMap(({ answer }) => (answer.kind === 'parsed' ? [] : [answer]))
    if (feeds.length === 0 && failure) return failure
    return { kind: 'previewed', preview: { kind: 'page', host: new URL(retrieved.url).hostname, feeds } }
  }

  /**
   * Names the Feed as ingestion would and orders its Feed Items by the stored
   * chronology: publication time, unless missing or more than a day past now —
   * when the items would be first seen — and then now. Cadence counts them by
   * installation-timezone day over the strip's thirty days.
   */
  #summarise(feedUrl: string, answer: Extract<FeedAnswer, { kind: 'parsed' }>, now: Date): PreviewedFeed {
    const { retrieved, parsed } = answer
    const seenAt = now.toISOString()
    const latest = new Date(now.getTime() + DAY_MS).toISOString()
    // One Feed Item per identity, as storing the window would keep: the last
    // occurrence wins. Ties fall as stored ones do, the later in the document first.
    const items = [...new Map(parsed.items.map((item) => [item.dedupeKey, item])).values()]
      .reverse()
      .map((item) => ({
        title: item.title ?? 'Untitled',
        publishedAt: item.publishedAt,
        chronologyAt: item.publishedAt !== null && item.publishedAt <= latest ? item.publishedAt : seenAt,
      }))
      .sort((left, right) => right.chronologyAt.localeCompare(left.chronologyAt))

    const timezone = this.#settings.effectiveTimezone()
    const dayOf = dayKeysIn(timezone)
    const perDay = new Map<string, number>()
    for (const { chronologyAt } of items) {
      const day = dayOf(chronologyAt)
      perDay.set(day, (perDay.get(day) ?? 0) + 1)
    }

    return {
      feedUrl,
      title: parsed.title,
      domain: feedDomain(parsed, retrieved.url),
      homePageUrl: parsed.homePageUrl,
      cadence: trailingDayKeys(dateKey(now, timezone), CADENCE_STRIP_DAYS).map((day) => perDay.get(day) ?? 0),
      lastItemAt: items[0]?.chronologyAt ?? null,
      items: items.slice(0, FEED_PREVIEW_ITEMS).map(({ title, publishedAt }) => ({ title, publishedAt })),
      subscribed: [feedUrl, retrieved.url].some((url) => subscribedFeedId(this.#db, url) !== undefined),
    }
  }
}

/** Served as a Feed media type, or as a page but rooted like a Feed document. */
function servesFeed(retrieved: RetrievalBytes): boolean {
  if (RETRIEVAL_PROFILES.feed.accept.includes(retrieved.contentType)) return true
  return FEED_ROOT.test(new TextDecoder().decode(retrieved.bytes.subarray(0, 1_024)))
}
