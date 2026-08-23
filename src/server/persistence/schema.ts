import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Typed mirror of the tables the server queries; migrations remain the source of truth. */
export const installationSettings = sqliteTable(
  'installation_settings',
  {
    id: integer('id').primaryKey(),
    timezone: text('timezone').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('installation_settings_singleton', sql`${table.id} = 1`)],
)

/** The User's Argon2id verifier. Its existence is what "claimed" means. */
export const userAuth = sqliteTable(
  'user_auth',
  {
    id: integer('id').primaryKey(),
    passwordHash: text('password_hash').notNull(),
    claimedAt: text('claimed_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('user_auth_singleton', sql`${table.id} = 1`)],
)

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
  enteredUrl: text('entered_url').notNull().unique(),
  resolvedUrl: text('resolved_url').notNull().unique(),
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
export const feedUrlAliases = sqliteTable(
  'feed_url_aliases',
  {
    url: text('url').primaryKey(),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
  },
  (table) => [index('feed_url_aliases_feed_id').on(table.feedId)],
)

/** The User's active choice to include a Feed in the Digest. */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    feedId: integer('feed_id')
      .primaryKey()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    /** The Custom Title; null means the Feed's reported title stands. */
    customTitle: text('custom_title'),
    /** The Custom Description; null means the Feed Description stands. */
    customDescription: text('custom_description'),
    pollingIntervalMinutes: integer('polling_interval_minutes').notNull().default(120),
    /** The persisted due-time frontier the scheduler wakes to query. */
    nextPollAt: text('next_poll_at').notNull(),
    lastPolledAt: text('last_polled_at'),
    /** Feed Availability: how the recent attempts went, in safe categories. */
    lastSuccessAt: text('last_success_at'),
    lastFailureAt: text('last_failure_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastFailureCategory: text('last_failure_category', {
      enum: ['unreachable', 'timeout', 'too_large', 'unsupported_content', 'http_error', 'invalid_feed'],
    }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('subscriptions_next_poll_at').on(table.nextPollAt)],
)

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
export const feedItems = sqliteTable(
  'feed_items',
  {
    id: integer('id').primaryKey(),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    identityKind: text('identity_kind', { enum: ['guid', 'link', 'content'] }).notNull(),
    title: text('title'),
    link: text('link'),
    publishedAt: text('published_at'),
    imageUrl: text('image_url'),
    summary: text('summary'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastObservedAt: text('last_observed_at').notNull(),
  },
  (table) => [
    uniqueIndex('feed_items_feed_dedupe').on(table.feedId, table.dedupeKey),
    index('feed_items_chronology').on(table.publishedAt, table.firstSeenAt),
    index('feed_items_last_observed').on(table.lastObservedAt),
  ],
)

/**
 * FTS5 index over Feed Items; `rowid` mirrors `feed_items.id`. Declared for
 * querying only — the migration 6 and 12 triggers keep it in step.
 */
export const feedItemSearch = sqliteTable('feed_item_search', {
  rowid: integer('rowid').notNull(),
  itemTitle: text('item_title'),
  summary: text('summary'),
  feedTitle: text('feed_title'),
})

/** Explicit Library membership; ingestion never rewrites this table. */
export const libraryItems = sqliteTable('library_items', {
  feedItemId: integer('feed_item_id')
    .primaryKey()
    .references(() => feedItems.id, { onDelete: 'cascade' }),
  savedAt: text('saved_at').notNull(),
})
