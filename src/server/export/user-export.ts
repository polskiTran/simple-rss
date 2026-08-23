import { eq } from 'drizzle-orm'
import { VERSION } from '../../shared/version.js'
import type { Clock } from '../clock.js'
import type { DrizzleDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { feedItems, feeds, libraryItems, subscriptions } from '../persistence/schema.js'

export const USER_EXPORT_FORMAT = 'simple-rss-export'

/** 3 dropped `schemaVersion`: the export names its own shape, not migration bookkeeping. */
export const USER_EXPORT_VERSION = 3

export interface UserExportItem {
  readonly dedupeKey: string
  readonly identityKind: 'guid' | 'link' | 'content'
  readonly title: string | null
  readonly link: string | null
  readonly publishedAt: string | null
  readonly imageUrl: string | null
  readonly summary: string | null
  readonly firstSeenAt: string
  readonly lastObservedAt: string
  readonly savedAt: string | null
}

/** `subscription` is null for a Feed kept only because Library saves still attribute to it. */
export interface UserExportFeed {
  readonly enteredUrl: string
  readonly resolvedUrl: string
  /** The reported title and Feed Description; the User's overrides live on `subscription`. */
  readonly title: string
  readonly description: string | null
  readonly domain: string
  readonly homePageUrl: string | null
  readonly createdAt: string
  readonly subscription: {
    readonly pollingIntervalMinutes: number
    readonly customTitle: string | null
    readonly customDescription: string | null
    readonly createdAt: string
  } | null
  readonly items: readonly UserExportItem[]
}

export interface UserExport {
  readonly format: typeof USER_EXPORT_FORMAT
  readonly exportVersion: typeof USER_EXPORT_VERSION
  readonly applicationVersion: string
  readonly exportedAt: string
  readonly installation: { readonly timezone: string }
  readonly feeds: readonly UserExportFeed[]
}

export function buildUserExport(options: {
  db: DrizzleDatabase
  settings: InstallationSettingsStore
  clock: Clock
}): UserExport {
  const { db, settings, clock } = options

  return db.transaction((tx): UserExport => {
    const feedRows = tx
      .select({
        id: feeds.id,
        enteredUrl: feeds.enteredUrl,
        resolvedUrl: feeds.resolvedUrl,
        title: feeds.title,
        description: feeds.description,
        domain: feeds.domain,
        homePageUrl: feeds.homePageUrl,
        createdAt: feeds.createdAt,
        pollingIntervalMinutes: subscriptions.pollingIntervalMinutes,
        customTitle: subscriptions.customTitle,
        customDescription: subscriptions.customDescription,
        subscribedAt: subscriptions.createdAt,
      })
      .from(feeds)
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .orderBy(feeds.id)
      .all()

    const itemRows = tx
      .select({
        feedId: feedItems.feedId,
        dedupeKey: feedItems.dedupeKey,
        identityKind: feedItems.identityKind,
        title: feedItems.title,
        link: feedItems.link,
        publishedAt: feedItems.publishedAt,
        imageUrl: feedItems.imageUrl,
        summary: feedItems.summary,
        firstSeenAt: feedItems.firstSeenAt,
        lastObservedAt: feedItems.lastObservedAt,
        savedAt: libraryItems.savedAt,
      })
      .from(feedItems)
      .leftJoin(libraryItems, eq(libraryItems.feedItemId, feedItems.id))
      .orderBy(feedItems.id)
      .all()

    const itemsOfFeed = new Map<number, UserExportItem[]>()
    for (const { feedId, ...item } of itemRows) {
      const bucket = itemsOfFeed.get(feedId)
      if (bucket) bucket.push(item)
      else itemsOfFeed.set(feedId, [item])
    }

    const exportedFeeds = feedRows.map(
      (feed): UserExportFeed => ({
        enteredUrl: feed.enteredUrl,
        resolvedUrl: feed.resolvedUrl,
        title: feed.title,
        description: feed.description,
        domain: feed.domain,
        homePageUrl: feed.homePageUrl,
        createdAt: feed.createdAt,
        subscription:
          feed.pollingIntervalMinutes === null || feed.subscribedAt === null
            ? null
            : {
                pollingIntervalMinutes: feed.pollingIntervalMinutes,
                customTitle: feed.customTitle,
                customDescription: feed.customDescription,
                createdAt: feed.subscribedAt,
              },
        items: itemsOfFeed.get(feed.id) ?? [],
      }),
    )

    return {
      format: USER_EXPORT_FORMAT,
      exportVersion: USER_EXPORT_VERSION,
      applicationVersion: VERSION,
      exportedAt: clock.now().toISOString(),
      installation: { timezone: settings.effectiveTimezone() },
      feeds: exportedFeeds,
    }
  })
}
