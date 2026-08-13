import { VERSION } from '../../shared/version.js'
import type { Clock } from '../clock.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { appliedVersions } from '../persistence/migrations.js'

export const USER_EXPORT_FORMAT = 'simple-rss-export'

// The export format's own version, independent of the database schema; it
// moves only when the format changes incompatibly.
export const USER_EXPORT_VERSION = 1

/** `dedupeKey` and `identityKind` let a future import re-identify the item instead of duplicating it. */
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
  readonly title: string
  readonly domain: string
  readonly homePageUrl: string | null
  readonly createdAt: string
  readonly subscription: {
    readonly pollingIntervalMinutes: number
    readonly createdAt: string
  } | null
  readonly items: readonly UserExportItem[]
}

/**
 * The User's portable reading state. It deliberately never carries the password
 * verifier, session hashes, the Setup Secret, rate-limit state, validators, due
 * times, derived search rows, or migration records — the installation's
 * operational property, not the User's reading.
 */
export interface UserExport {
  readonly format: typeof USER_EXPORT_FORMAT
  readonly exportVersion: typeof USER_EXPORT_VERSION
  /** The highest applied migration, naming the schema the data came from. */
  readonly schemaVersion: number
  readonly applicationVersion: string
  readonly exportedAt: string
  readonly installation: { readonly timezone: string }
  readonly feeds: readonly UserExportFeed[]
}

interface FeedRow {
  id: number
  enteredUrl: string
  resolvedUrl: string
  title: string
  domain: string
  homePageUrl: string | null
  createdAt: string
  pollingIntervalMinutes: number | null
  subscribedAt: string | null
}

interface ItemRow extends Omit<UserExportItem, 'identityKind'> {
  identityKind: string
}

/**
 * One consistent snapshot, built in memory: Retention bounds the document to a
 * few megabytes at the ~100-Subscription target.
 */
export function buildUserExport(options: {
  database: SqliteDatabase
  settings: InstallationSettingsStore
  clock: Clock
}): UserExport {
  const { database, settings, clock } = options

  return database.transaction((): UserExport => {
    const feedRows = database
      .prepare(
        `SELECT
           feeds.id                               AS id,
           feeds.entered_url                      AS enteredUrl,
           feeds.resolved_url                     AS resolvedUrl,
           feeds.title                            AS title,
           feeds.domain                           AS domain,
           feeds.home_page_url                    AS homePageUrl,
           feeds.created_at                       AS createdAt,
           subscriptions.polling_interval_minutes AS pollingIntervalMinutes,
           subscriptions.created_at               AS subscribedAt
         FROM feeds
         LEFT JOIN subscriptions ON subscriptions.feed_id = feeds.id
         ORDER BY feeds.id`,
      )
      .all() as FeedRow[]

    const itemsOfFeed = database.prepare(
      `SELECT
         feed_items.dedupe_key       AS dedupeKey,
         feed_items.identity_kind    AS identityKind,
         feed_items.title            AS title,
         feed_items.link             AS link,
         feed_items.published_at     AS publishedAt,
         feed_items.image_url        AS imageUrl,
         feed_items.summary          AS summary,
         feed_items.first_seen_at    AS firstSeenAt,
         feed_items.last_observed_at AS lastObservedAt,
         library_items.saved_at      AS savedAt
       FROM feed_items
       LEFT JOIN library_items ON library_items.feed_item_id = feed_items.id
       WHERE feed_items.feed_id = ?
       ORDER BY feed_items.id`,
    )

    const feeds = feedRows.map(
      (feed): UserExportFeed => ({
        enteredUrl: feed.enteredUrl,
        resolvedUrl: feed.resolvedUrl,
        title: feed.title,
        domain: feed.domain,
        homePageUrl: feed.homePageUrl,
        createdAt: feed.createdAt,
        subscription:
          feed.pollingIntervalMinutes === null || feed.subscribedAt === null
            ? null
            : { pollingIntervalMinutes: feed.pollingIntervalMinutes, createdAt: feed.subscribedAt },
        items: (itemsOfFeed.all(feed.id) as ItemRow[]).map(
          (item): UserExportItem => ({ ...item, identityKind: item.identityKind as UserExportItem['identityKind'] }),
        ),
      }),
    )

    return {
      format: USER_EXPORT_FORMAT,
      exportVersion: USER_EXPORT_VERSION,
      schemaVersion: Math.max(0, ...appliedVersions(database)),
      applicationVersion: VERSION,
      exportedAt: clock.now().toISOString(),
      installation: { timezone: settings.effectiveTimezone() },
      feeds,
    }
  })()
}
