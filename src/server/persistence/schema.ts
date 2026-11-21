import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { FEED_ITEM_CHRONOLOGY_SQL } from './feed-item-chronology.js'
import {
  DEFAULT_POLLING_INTERVAL_MINUTES,
  DEFAULT_READING_SOURCE,
  FEED_AVAILABILITY_CATEGORIES,
  type PollingIntervalMinutes,
  READING_SOURCES,
} from '../../shared/api.js'

export const installationSettings = sqliteTable('installation_settings', {
  id: integer('id').primaryKey(),
  timezone: text('timezone').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const userAuth = sqliteTable('user_auth', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  claimedAt: text('claimed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const writeProbe = sqliteTable('write_probe', {
  id: integer('id').primaryKey(),
  checkedAt: text('checked_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

export const feeds = sqliteTable('feeds', {
  id: integer('id').primaryKey(),
  enteredUrl: text('entered_url').notNull(),
  resolvedUrl: text('resolved_url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  domain: text('domain').notNull(),
  homePageUrl: text('home_page_url'),
  etag: text('etag'),
  lastModified: text('last_modified'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const feedUrlAliases = sqliteTable('feed_url_aliases', {
  url: text('url').primaryKey(),
  feedId: integer('feed_id').notNull(),
})

export const subscriptions = sqliteTable('subscriptions', {
  feedId: integer('feed_id').primaryKey(),
  customTitle: text('custom_title'),
  customDescription: text('custom_description'),
  pollingIntervalMinutes: integer('polling_interval_minutes')
    .$type<PollingIntervalMinutes>()
    .notNull()
    .default(DEFAULT_POLLING_INTERVAL_MINUTES),
  readingSource: text('reading_source', { enum: READING_SOURCES }).notNull().default(DEFAULT_READING_SOURCE),
  nextPollAt: text('next_poll_at').notNull().default('1970-01-01T00:00:00.000Z'),
  lastPolledAt: text('last_polled_at'),
  lastSuccessAt: text('last_success_at'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastFailureCategory: text('last_failure_category', { enum: FEED_AVAILABILITY_CATEGORIES }),
  createdAt: text('created_at').notNull(),
})

export const effectiveFeedTitle = sql<string>`coalesce(${subscriptions.customTitle}, ${feeds.title})`

export const effectiveFeedDescription = sql<
  string | null
>`coalesce(${subscriptions.customDescription}, ${feeds.description})`

export const feedItems = sqliteTable('feed_items', {
  id: integer('id').primaryKey(),
  feedId: integer('feed_id').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  identityKind: text('identity_kind', { enum: ['guid', 'link', 'content'] }).notNull(),
  title: text('title'),
  link: text('link'),
  discussionUrl: text('discussion_url'),
  publishedAt: text('published_at'),
  imageUrl: text('image_url'),
  summary: text('summary'),
  feedContentMarkdown: text('feed_content_markdown'),
  feedContentTruncated: integer('feed_content_truncated').notNull().default(0),
  firstSeenAt: text('first_seen_at').notNull(),
  lastObservedAt: text('last_observed_at').notNull(),
  chronologyAt: text('chronology_at')
    .notNull()
    .generatedAlwaysAs(sql.raw(FEED_ITEM_CHRONOLOGY_SQL), { mode: 'virtual' }),
})

export const libraryItems = sqliteTable('library_items', {
  feedItemId: integer('feed_item_id').primaryKey(),
  savedAt: text('saved_at').notNull(),
})
