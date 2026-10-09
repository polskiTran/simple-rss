import { eq } from 'drizzle-orm'
import { DEFAULT_READING_SOURCE, type ReaderItem } from '../../shared/api.js'
import type { Clock } from '../clock.js'
import { dateKey, longDate } from '../digest/chronology.js'
import type { DigestService } from '../digest/digest-service.js'
import type { SignImageUrl } from '../images/image-url-signature.js'
import { applyReaderMarkdownPolicy } from '../markdown/markdown-policy.js'
import { readingTimeMinutes } from '../markdown/reading-time.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { effectiveFeedTitle, feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'

/**
 * What Reader View opens a Feed Item with: its stored Feed Content, the
 * Subscription's Reading Source, and the next Feed Item in the Digest.
 * Original webpage extraction is `ReaderService`'s.
 */
export class ReaderItems {
  readonly #db: DrizzleDatabase
  readonly #clock: Clock
  readonly #settings: InstallationSettingsStore
  readonly #digest: DigestService
  readonly #signImageUrl: SignImageUrl

  constructor(options: {
    db: DrizzleDatabase
    clock: Clock
    settings: InstallationSettingsStore
    digest: DigestService
    signImageUrl: SignImageUrl
  }) {
    this.#db = options.db
    this.#clock = options.clock
    this.#settings = options.settings
    this.#digest = options.digest
    this.#signImageUrl = options.signImageUrl
  }

  item(feedItemId: number): ReaderItem | undefined {
    const row = this.#db
      .select({
        feedItemId: feedItems.id,
        title: feedItems.title,
        feedId: feeds.id,
        feedTitle: effectiveFeedTitle,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        summary: feedItems.summary,
        feedContentMarkdown: feedItems.feedContentMarkdown,
        feedContentTruncated: feedItems.feedContentTruncated,
        firstSeenAt: feedItems.firstSeenAt,
        chronologyAt: feedItems.chronologyAt,
        savedAt: libraryItems.savedAt,
        readingSource: subscriptions.readingSource,
      })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!row) return undefined

    const timezone = this.#settings.effectiveTimezone()

    return {
      feedItemId: row.feedItemId,
      title: row.title ?? 'Untitled',
      feedId: row.feedId,
      feedTitle: row.feedTitle,
      link: row.link,
      publishedAt: row.publishedAt,
      firstSeenAt: row.firstSeenAt,
      displayDate: longDate(new Date(row.chronologyAt), dateKey(this.#clock.now(), timezone), timezone),
      summary: row.summary,
      feedContent: row.feedContentMarkdown
        ? {
            // Stored destinations are absolute; no original webpage is needed to refresh capabilities.
            markdown: applyReaderMarkdownPolicy(row.feedContentMarkdown, { images: this.#signImageUrl }),
            truncated: row.feedContentTruncated !== 0,
            readingTimeMinutes: readingTimeMinutes(row.feedContentMarkdown),
          }
        : null,
      saved: row.savedAt !== null,
      readingSource: row.readingSource ?? DEFAULT_READING_SOURCE,
      nextInDigest: this.#nextInDigest(feedItemId),
    }
  }

  #nextInDigest(feedItemId: number): ReaderItem['nextInDigest'] {
    const next = this.#digest.after(feedItemId)
    if (!next) return null
    return {
      feedItemId: next.feedItemId,
      title: next.title,
      feedTitle: next.feedTitle,
      displayTime: next.displayTime,
    }
  }
}
