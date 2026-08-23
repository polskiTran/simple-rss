import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  PREVIEW_ITEM_COUNT,
  type DeclaredFeed,
  type FeedPreview as PresentedPreview,
  type PreviewItem,
} from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, inDigestOrder } from '../digest/chronology.js'
import { declaredFeeds } from '../ingestion/declared-feeds.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedDescription, effectiveFeedTitle, feedItems, feeds, subscriptions } from '../persistence/schema.js'
import { RETRIEVAL_PROFILES, type Retrieval, type RetrievalLimits } from '../upstream/retrieval.js'
import { aliasOwnerOf, canonicalFeedUrl } from './feed-aliases.js'
import type { FailedPoll } from './feed-availability.js'
import { loggableUrl } from './loggable-url.js'
import { answeredWithPage, proveFeed, type ProvenFeed } from './prove-feed.js'

export type PreviewOutcome =
  | { readonly kind: 'previewed'; readonly preview: PresentedPreview }
  | { readonly kind: 'invalid-url' }
  | { readonly kind: 'no-feed-found' }
  | FailedPoll

interface SubscribedFeed {
  readonly feedId: number
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
}

/** Reads the store and the publisher; never writes either (ADR 0009). */
export class FeedPreview {
  readonly #db: BetterSQLite3Database
  readonly #retrieval: Retrieval
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore
  readonly #logger: Logger

  constructor(options: {
    database: SqliteDatabase
    retrieval: Retrieval
    clock: Clock
    settings: InstallationSettingsStore
    logger: Logger
  }) {
    this.#db = drizzle(options.database)
    this.#retrieval = options.retrieval
    this.#clock = options.clock
    this.#settings = options.settings
    this.#logger = options.logger.child({ component: 'subscriptions' })
  }

  /**
   * A pasted Feed is proven under `preview`. A pasted page is read again under
   * `discovery` and its first Declared Feed proven in turn — the three
   * retrievals share the preview profile's one deadline, each handed what the
   * earlier ones left. A Feed already subscribed, pasted or declared, is
   * answered from the store without asking the publisher.
   */
  async preview(enteredUrl: string, signal?: AbortSignal): Promise<PreviewOutcome> {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }
    const budget = startBudget(RETRIEVAL_PROFILES.preview.deadline.timeoutMs)

    const known = this.#knownSubscription(requestedUrl)
    if (known) return this.#answerFromStore(requestedUrl, known, [])

    const proof = await proveFeed({
      retrieval: this.#retrieval,
      url: requestedUrl,
      operation: 'preview',
      ...(signal && { signal }),
    })
    if (proof.kind === 'proven') return this.#answerFromProof(requestedUrl, proof, [])
    if (!answeredWithPage(proof)) return proof

    const page = await this.#retrieval.retrieveBytes({
      url: requestedUrl,
      operation: 'discovery',
      ...(signal && { signal }),
      limits: budget.remaining(),
    })
    if (!page.ok) return { kind: 'retrieval-failed', failure: page }
    const declared = declaredFeeds(page.bytes, page.url, page.charset)
    const [first] = declared
    if (!first) {
      this.#logger.info('subscriptions.no_feed_declared', { url: loggableUrl(requestedUrl) })
      return { kind: 'no-feed-found' }
    }

    const knownDeclared = this.#knownSubscription(first.url)
    if (knownDeclared) return this.#answerFromStore(first.url, knownDeclared, declared)

    const declaredProof = await proveFeed({
      retrieval: this.#retrieval,
      url: first.url,
      operation: 'preview',
      ...(signal && { signal }),
      limits: budget.remaining(),
    })
    if (declaredProof.kind !== 'proven') return declaredProof
    return this.#answerFromProof(first.url, declaredProof, declared)
  }

  #knownSubscription(url: string): SubscribedFeed | undefined {
    const owner = aliasOwnerOf(this.#db, url)
    return owner?.subscribed ? this.#subscribedFeed(owner.feedId) : undefined
  }

  #answerFromStore(url: string, feed: SubscribedFeed, declaredFeeds: DeclaredFeed[]): PreviewOutcome {
    const { feedId, ...rest } = feed
    this.#logger.info('subscriptions.feed_previewed', { url: loggableUrl(url), feedId })
    return {
      kind: 'previewed',
      preview: { url, ...rest, items: this.#retainedItems(feedId), declaredFeeds, subscribed: { feedId } },
    }
  }

  /** A redirect can land on a subscribed Feed after the fetch; then the store names it and the fetch fills the items. */
  #answerFromProof(url: string, { retrieved, parsed }: ProvenFeed, declaredFeeds: DeclaredFeed[]): PreviewOutcome {
    const feed = this.#knownSubscription(retrieved.url)
    this.#logger.info('subscriptions.feed_previewed', {
      url: loggableUrl(url),
      resolvedUrl: loggableUrl(retrieved.url),
      ...(feed && { feedId: feed.feedId }),
      ...(declaredFeeds.length > 0 && { declaredFeeds: declaredFeeds.length }),
    })
    return {
      kind: 'previewed',
      preview: {
        url,
        title: feed?.title ?? parsed.title,
        description: feed ? feed.description : parsed.description,
        domain: new URL(parsed.homePageUrl ?? retrieved.url).hostname,
        homePageUrl: parsed.homePageUrl,
        items: this.#present(
          newestFirst(
            parsed.items.map((item) => ({ title: item.title, link: item.link, publishedAt: item.publishedAt })),
          ),
        ),
        declaredFeeds,
        subscribed: feed ? { feedId: feed.feedId } : null,
      },
    }
  }

  #subscribedFeed(feedId: number): SubscribedFeed {
    const feed = this.#db
      .select({
        feedId: feeds.id,
        title: effectiveFeedTitle,
        description: effectiveFeedDescription,
        domain: feeds.domain,
        homePageUrl: feeds.homePageUrl,
      })
      .from(feeds)
      .innerJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(eq(feeds.id, feedId))
      .limit(1)
      .all()[0]
    if (!feed) throw new Error(`Feed ${feedId} is not subscribed`)
    return feed
  }

  #retainedItems(feedId: number): PreviewItem[] {
    const rows = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        firstSeenAt: feedItems.firstSeenAt,
      })
      .from(feedItems)
      .where(eq(feedItems.feedId, feedId))
      .all()
    return this.#present(inDigestOrder(rows, this.#clock.now()).map(({ row }) => row))
  }

  #present(items: readonly UnpresentedItem[]): PreviewItem[] {
    const timezone = this.#settings.effectiveTimezone()
    const now = this.#clock.now()
    const today = dateKey(now, timezone)
    return items.slice(0, PREVIEW_ITEM_COUNT).map((item) => ({
      title: item.title ?? 'untitled',
      link: item.link,
      publishedAt: item.publishedAt,
      displayDate: relativeDate(item.publishedAt, today, timezone),
    }))
  }
}

interface UnpresentedItem {
  readonly title: string | null
  readonly link: string | null
  readonly publishedAt: string | null
}

/** One clock over every retrieval a preview makes; the boundary floors a spent budget at its minimum. */
function startBudget(totalMs: number): { remaining(): RetrievalLimits } {
  const startedAt = performance.now()
  return { remaining: () => ({ timeoutMs: totalMs - (performance.now() - startedAt) }) }
}

function newestFirst<Item extends UnpresentedItem>(items: readonly Item[]): Item[] {
  const dated = items.filter((item): item is Item & { publishedAt: string } => item.publishedAt !== null)
  const undated = items.filter((item) => item.publishedAt === null)
  dated.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
  return [...dated, ...undated]
}

const DAY_MS = 24 * 60 * 60 * 1_000

function relativeDate(publishedAt: string | null, today: string, timezone: string): string {
  if (publishedAt === null) return 'undated'
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published)) return 'undated'

  const days = Math.max(
    0,
    Math.round((Date.parse(today) - Date.parse(dateKey(new Date(published), timezone))) / DAY_MS),
  )
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 61) return `${Math.floor(days / 7)} weeks ago`
  return `${Math.max(2, Math.round(days / 30.44))} months ago`
}
