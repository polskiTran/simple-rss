import { VERSION } from '../../shared/version.js'
import type { Clock } from '../clock.js'
import type { SqliteDatabase } from '../persistence/database.js'
import type { InstallationSettingsStore } from '../persistence/installation-settings.js'
import { appliedVersions } from '../persistence/migrations.js'

/** The marker a reader of the file uses to recognize what it is holding. */
export const USER_EXPORT_FORMAT = 'simple-rss-export'

/**
 * The version of this document's own shape, independent of the database
 * schema. It moves only when the export format itself changes incompatibly.
 */
export const USER_EXPORT_VERSION = 1

/**
 * One retained Feed Item as it travels. `savedAt` is Library membership;
 * `dedupeKey` and `identityKind` are included so a future import can
 * re-identify the item instead of duplicating it.
 */
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

/**
 * One Feed with the User's relationship to it. `subscription` is null for a
 * Feed kept only because Library saves still attribute to it.
 */
export interface UserExportFeed {
  readonly enteredUrl: string
  readonly resolvedUrl: string
  readonly title: string
  readonly domain: string
  readonly createdAt: string
  readonly subscription: {
    readonly pollingIntervalMinutes: number
    readonly createdAt: string
  } | null
  readonly items: readonly UserExportItem[]
}

/**
 * The User's portable reading state, complete enough to carry Subscriptions,
 * Polling Intervals, retained Feed Items, Library membership, and preferences
 * to another installation or another reader.
 *
 * What it deliberately never carries: the password verifier, session hashes,
 * the setup secret, rate-limit state, conditional-request validators, the
 * polling schedule's due times, derived search rows, and migration records.
 * Those are this installation's operational property, not the User's reading.
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
  createdAt: string
  pollingIntervalMinutes: number | null
  subscribedAt: string | null
}

interface ItemRow extends Omit<UserExportItem, 'identityKind'> {
  identityKind: string
}

/**
 * Reads the whole export in one consistent snapshot. The document is built in
 * memory because Retention bounds it: at the ~100-Subscription target with 90
 * days of history it stays a few megabytes, never an unbounded stream.
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
