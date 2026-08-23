import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * Typed mirror of the tables the server queries; migrations remain the source of
 * truth, and tests/server/persistence/schema-mirror.test.ts holds the two in step.
 */
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

/** Readiness' reusable write target (`assertWritable`); one row, rewritten in place. */
export const writeProbe = sqliteTable(
  'write_probe',
  {
    id: integer('id').primaryKey(),
    checkedAt: text('checked_at').notNull(),
  },
  (table) => [check('write_probe_singleton', sql`${table.id} = 1`)],
)

/** One signed-in device, keyed by the hash of the token it presents. */
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('sessions_expires_at').on(table.expiresAt)],
)

/** Publisher-owned Feed metadata and the two intentionally distinct URLs. */
export const feeds = sqliteTable(
  'feeds',
  {
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
  },
  (table) => [
    check('feeds_title_length', sql`length(${table.title}) BETWEEN 1 AND 512`),
    check(
      'feeds_description_length',
      sql`${table.description} IS NULL OR length(${table.description}) BETWEEN 1 AND 1024`,
    ),
  ],
)

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
    nextPollAt: text('next_poll_at').notNull().default('1970-01-01T00:00:00.000Z'),
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
  (table) => [
    index('subscriptions_next_poll_at').on(table.nextPollAt),
    // Keep in step with pollingIntervalMinutesSchema (shared/api.ts).
    check('subscriptions_polling_interval', sql`${table.pollingIntervalMinutes} IN (30, 60, 120, 360, 720, 1440)`),
    check('subscriptions_consecutive_failures', sql`${table.consecutiveFailures} >= 0`),
    check(
      'subscriptions_failure_category',
      sql`${table.lastFailureCategory} IN ('unreachable', 'timeout', 'too_large', 'unsupported_content', 'http_error', 'invalid_feed')`,
    ),
    check(
      'subscriptions_custom_title_length',
      sql`${table.customTitle} IS NULL OR length(${table.customTitle}) BETWEEN 1 AND 512`,
    ),
    check(
      'subscriptions_custom_description_length',
      sql`${table.customDescription} IS NULL OR length(${table.customDescription}) BETWEEN 1 AND 1024`,
    ),
  ],
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
    unique('feed_items_feed_dedupe').on(table.feedId, table.dedupeKey),
    index('feed_items_chronology').on(table.publishedAt, table.firstSeenAt),
    index('feed_items_last_observed').on(table.lastObservedAt),
    check('feed_items_identity_kind', sql`${table.identityKind} IN ('guid', 'link', 'content')`),
  ],
)

/** Explicit Library membership; ingestion never rewrites this table. */
export const libraryItems = sqliteTable('library_items', {
  feedItemId: integer('feed_item_id')
    .primaryKey()
    .references(() => feedItems.id, { onDelete: 'cascade' }),
  savedAt: text('saved_at').notNull(),
})
