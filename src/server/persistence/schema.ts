import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import {
  DEFAULT_POLLING_INTERVAL_MINUTES,
  DEFAULT_READING_SOURCE,
  FEED_AVAILABILITY_CATEGORIES,
  type PollingIntervalMinutes,
  READING_SOURCES,
} from '../../shared/api.js'

/**
 * Query-side typing for the tables the server reads and writes: columns, types,
 * nullability, and defaults. Migrations own every constraint and index (CHECKs,
 * uniques, foreign keys); tests/server/persistence/schema-columns.test.ts holds
 * the columns here to the migrated database.
 */
export const installationSettings = sqliteTable('installation_settings', {
  id: integer('id').primaryKey(),
  timezone: text('timezone').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** The User's Argon2id verifier. Its existence is what "claimed" means. */
export const userAuth = sqliteTable('user_auth', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  claimedAt: text('claimed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Readiness' reusable write target (`assertWritable`); one row, rewritten in place. */
export const writeProbe = sqliteTable('write_probe', {
  id: integer('id').primaryKey(),
  checkedAt: text('checked_at').notNull(),
})

/** One signed-in device, keyed by the hash of the token it presents. */
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

/** Publisher-owned Feed metadata and the two intentionally distinct URLs. */
export const feeds = sqliteTable('feeds', {
  id: integer('id').primaryKey(),
  enteredUrl: text('entered_url').notNull(),
  resolvedUrl: text('resolved_url').notNull(),
  title: text('title').notNull(),
  /** The Feed Description; null when the document reports none. Refreshed with the title. */
  description: text('description'),
  /** The host shown for the Feed: the home page's when it declares one, else the Feed URL's. */
  domain: text('domain').notNull(),
  /** Null until a retrieval finds a site link that is not the Feed URL itself. */
  homePageUrl: text('home_page_url'),
  /** Validators from the last successful retrieval, for conditional requests. */
  etag: text('etag'),
  lastModified: text('last_modified'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Canonical request and redirect targets, unique across both URL roles. */
export const feedUrlAliases = sqliteTable('feed_url_aliases', {
  url: text('url').primaryKey(),
  feedId: integer('feed_id').notNull(),
})

/** The User's active choice to include a Feed in the Digest. */
export const subscriptions = sqliteTable('subscriptions', {
  feedId: integer('feed_id').primaryKey(),
  /** The Custom Title; null means the Feed's reported title stands. */
  customTitle: text('custom_title'),
  /** The Custom Description; null means the Feed Description stands. */
  customDescription: text('custom_description'),
  // The migration's CHECK is what makes the narrowed type true on read.
  pollingIntervalMinutes: integer('polling_interval_minutes')
    .$type<PollingIntervalMinutes>()
    .notNull()
    .default(DEFAULT_POLLING_INTERVAL_MINUTES),
  readingSource: text('reading_source', { enum: READING_SOURCES }).notNull().default(DEFAULT_READING_SOURCE),
  /** The persisted due-time frontier the scheduler wakes to query. */
  nextPollAt: text('next_poll_at').notNull().default('1970-01-01T00:00:00.000Z'),
  lastPolledAt: text('last_polled_at'),
  /** Feed Availability: how the recent attempts went, in safe categories. */
  lastSuccessAt: text('last_success_at'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastFailureCategory: text('last_failure_category', { enum: FEED_AVAILABILITY_CATEGORIES }),
  createdAt: text('created_at').notNull(),
})

/**
 * Requires a `subscriptions` join; left-join where the query can name unsubscribed Feeds.
 *
 * The search index denormalizes this expression per Feed Item: triggers (migrations 6
 * and 12) re-index a Feed's items when either side changes, and `rebuildSearchIndex`
 * (search/search-service.ts) restates it from scratch.
 */
export const effectiveFeedTitle = sql<string>`coalesce(${subscriptions.customTitle}, ${feeds.title})`

/** Same join rule; null when neither the User nor the Feed describes it. */
export const effectiveFeedDescription = sql<
  string | null
>`coalesce(${subscriptions.customDescription}, ${feeds.description})`

/** Normalized Feed Window entries, deduplicated only inside their Feed. */
export const feedItems = sqliteTable('feed_items', {
  id: integer('id').primaryKey(),
  feedId: integer('feed_id').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  identityKind: text('identity_kind', { enum: ['guid', 'link', 'content'] }).notNull(),
  title: text('title'),
  link: text('link'),
  publishedAt: text('published_at'),
  imageUrl: text('image_url'),
  summary: text('summary'),
  feedContentMarkdown: text('feed_content_markdown'),
  feedContentTruncated: integer('feed_content_truncated').notNull().default(0),
  firstSeenAt: text('first_seen_at').notNull(),
  lastObservedAt: text('last_observed_at').notNull(),
  /** Where the item sits in the Digest; generated by migration 16, never written. */
  chronologyAt: text('chronology_at')
    .notNull()
    .generatedAlwaysAs(
      sql`CASE
        WHEN published_at IS NOT NULL
          AND published_at <= strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at, '+1 day')
        THEN published_at
        ELSE first_seen_at
      END`,
      { mode: 'virtual' },
    ),
})

/** Explicit Library membership; ingestion never rewrites this table. */
export const libraryItems = sqliteTable('library_items', {
  feedItemId: integer('feed_item_id').primaryKey(),
  savedAt: text('saved_at').notNull(),
})
