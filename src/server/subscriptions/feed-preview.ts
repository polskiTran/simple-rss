import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { PREVIEW_ITEM_COUNT, type FeedPreview as PresentedPreview, type PreviewItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, inDigestOrder } from '../digest/chronology.js'
import type { Logger } from '../logger.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedDescription, effectiveFeedTitle, feedItems, feeds, subscriptions } from '../persistence/schema.js'
import type { Retrieval } from '../upstream/retrieval.js'
import { aliasOwnerOf, canonicalFeedUrl } from './feed-aliases.js'
import type { FailedPoll } from './feed-availability.js'
import { loggableUrl } from './loggable-url.js'
import { answeredWithPage, proveFeed } from './prove-feed.js'

export type PreviewOutcome =
  | { readonly kind: 'previewed'; readonly preview: PresentedPreview }
  | { readonly kind: 'invalid-url' }
  | { readonly kind: 'no-feed-found' }
  | FailedPoll

/** What a subscribed Feed contributes to its own preview: the name the User knows it by. */
interface SubscribedFeed {
  readonly feedId: number
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
}

/**
 * The question the dialog asks before anything is written (ADR 0009): what
 * would subscribing to this address get? Reads the store and the publisher;
 * never writes either.
 */
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
   * A typed URL that is already a subscribed Feed's alias answers from the
   * store without asking the publisher. Otherwise the Feed is proven under the
   * `preview` operation, and only then is the resolved URL looked up — a
   * redirect can land on a Feed the typed URL never named.
   */
  async preview(enteredUrl: string, signal?: AbortSignal): Promise<PreviewOutcome> {
    const requestedUrl = canonicalFeedUrl(enteredUrl)
    if (!requestedUrl) return { kind: 'invalid-url' }

    const known = aliasOwnerOf(this.#db, requestedUrl)
    if (known?.subscribed) {
      const { feedId, ...feed } = this.#subscribedFeed(known.feedId)
      this.#logger.info('subscriptions.feed_previewed', { url: loggableUrl(requestedUrl), feedId })
      return {
        kind: 'previewed',
        preview: {
          url: requestedUrl,
          ...feed,
          items: this.#retainedItems(feedId),
          declaredFeeds: [],
          subscribed: { feedId },
        },
      }
    }

    const proof = await proveFeed({
      retrieval: this.#retrieval,
      url: requestedUrl,
      operation: 'preview',
      ...(signal && { signal }),
    })
    if (proof.kind !== 'proven') return answeredWithPage(proof) ? { kind: 'no-feed-found' } : proof
    const { retrieved, parsed } = proof

    const revealed = aliasOwnerOf(this.#db, retrieved.url)
    const feed = revealed?.subscribed ? this.#subscribedFeed(revealed.feedId) : undefined
    this.#logger.info('subscriptions.feed_previewed', {
      url: loggableUrl(requestedUrl),
      resolvedUrl: loggableUrl(retrieved.url),
      ...(feed && { feedId: feed.feedId }),
    })
    return {
      kind: 'previewed',
      preview: {
        url: requestedUrl,
        title: feed?.title ?? parsed.title,
        description: feed ? feed.description : parsed.description,
        domain: new URL(parsed.homePageUrl ?? retrieved.url).hostname,
        homePageUrl: parsed.homePageUrl,
        items: this.#present(
          newestFirst(
            parsed.items.map((item) => ({ title: item.title, link: item.link, publishedAt: item.publishedAt })),
          ),
        ),
        declaredFeeds: [],
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

  /** The Feed's retained items in the chronology the Digest uses, so the dialog agrees with the opened Feed. */
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

/** Dated items newest first; undated ones after, still in document order. */
function newestFirst<Item extends UnpresentedItem>(items: readonly Item[]): Item[] {
  const dated = items.filter((item) => item.publishedAt !== null)
  const undated = items.filter((item) => item.publishedAt === null)
  dated.sort((left, right) => Date.parse(right.publishedAt ?? '') - Date.parse(left.publishedAt ?? ''))
  return [...dated, ...undated]
}

const DAY_MS = 24 * 60 * 60 * 1_000

/** `today` · `yesterday` · `N days ago` · `N weeks ago` · `N months ago`, by calendar days in the installation timezone. */
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
