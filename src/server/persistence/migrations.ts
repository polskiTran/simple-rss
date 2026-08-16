import { systemClock, type Clock } from '../clock.js'
import type { SqliteDatabase } from './database.js'

export interface Migration {
  /** 1-based, contiguous, and never reused or reordered once released. */
  readonly version: number
  readonly name: string
  readonly sql: string
}

/** Append-only: correct a released migration with a new one. */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'installation-foundation',
    sql: `
      CREATE TABLE installation_settings (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        timezone   TEXT    NOT NULL,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      CREATE TABLE write_probe (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        checked_at TEXT    NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'owner-authentication',
    sql: `
      CREATE TABLE owner_auth (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT    NOT NULL,
        claimed_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );

      CREATE TABLE sessions (
        token_hash   TEXT PRIMARY KEY,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL
      );

      CREATE INDEX sessions_expires_at ON sessions (expires_at);
    `,
  },
  {
    version: 3,
    name: 'feeds-subscriptions-and-items',
    sql: `
      CREATE TABLE feeds (
        id           INTEGER PRIMARY KEY,
        entered_url  TEXT NOT NULL UNIQUE,
        resolved_url TEXT NOT NULL UNIQUE,
        title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
        domain       TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE feed_url_aliases (
        url     TEXT PRIMARY KEY,
        feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE
      );
      CREATE INDEX feed_url_aliases_feed_id ON feed_url_aliases (feed_id);

      CREATE TABLE subscriptions (
        feed_id                  INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
        polling_interval_minutes INTEGER NOT NULL DEFAULT 120
          CHECK (polling_interval_minutes IN (30, 60, 120, 360, 720, 1440)),
        created_at               TEXT NOT NULL
      );

      CREATE TABLE feed_items (
        id               INTEGER PRIMARY KEY,
        feed_id          INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
        dedupe_key       TEXT NOT NULL,
        identity_kind    TEXT NOT NULL CHECK (identity_kind IN ('guid', 'link', 'content')),
        title            TEXT,
        link             TEXT,
        published_at     TEXT,
        image_url        TEXT,
        summary          TEXT,
        first_seen_at    TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        UNIQUE (feed_id, dedupe_key)
      );

      CREATE INDEX feed_items_chronology
        ON feed_items (published_at DESC, first_seen_at DESC);
      CREATE INDEX feed_items_last_observed
        ON feed_items (last_observed_at);

      CREATE TABLE library_items (
        feed_item_id INTEGER PRIMARY KEY REFERENCES feed_items(id) ON DELETE CASCADE,
        saved_at     TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    name: 'polling-schedule',
    sql: `
      ALTER TABLE feeds ADD COLUMN etag TEXT;
      ALTER TABLE feeds ADD COLUMN last_modified TEXT;

      ALTER TABLE subscriptions ADD COLUMN next_poll_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
      ALTER TABLE subscriptions ADD COLUMN last_polled_at TEXT;
      UPDATE subscriptions SET next_poll_at = created_at;

      CREATE INDEX subscriptions_next_poll_at ON subscriptions (next_poll_at);
    `,
  },
  {
    version: 5,
    name: 'feed-availability',
    sql: `
      ALTER TABLE subscriptions ADD COLUMN last_success_at TEXT;
      ALTER TABLE subscriptions ADD COLUMN last_failure_at TEXT;
      ALTER TABLE subscriptions ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failures >= 0);

      ALTER TABLE subscriptions ADD COLUMN last_failure_category TEXT
        CHECK (last_failure_category IN
          ('unreachable', 'timeout', 'too_large', 'unsupported_content', 'http_error', 'invalid_feed'));
    `,
  },
  {
    version: 6,
    name: 'feed-item-search',
    sql: `
      CREATE VIRTUAL TABLE feed_item_search USING fts5(
        item_title,
        summary,
        feed_title,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER feed_item_search_after_insert AFTER INSERT ON feed_items BEGIN
        INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
        VALUES (new.id, new.title, new.summary, (SELECT title FROM feeds WHERE id = new.feed_id));
      END;

      CREATE TRIGGER feed_item_search_after_update AFTER UPDATE ON feed_items
      WHEN old.title IS NOT new.title OR old.summary IS NOT new.summary BEGIN
        DELETE FROM feed_item_search WHERE rowid = old.id;
        INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
        VALUES (new.id, new.title, new.summary, (SELECT title FROM feeds WHERE id = new.feed_id));
      END;

      CREATE TRIGGER feed_item_search_after_delete AFTER DELETE ON feed_items BEGIN
        DELETE FROM feed_item_search WHERE rowid = old.id;
      END;

      CREATE TRIGGER feed_item_search_after_feed_rename AFTER UPDATE OF title ON feeds
      WHEN old.title IS NOT new.title BEGIN
        UPDATE feed_item_search SET feed_title = new.title
        WHERE rowid IN (SELECT id FROM feed_items WHERE feed_id = new.id);
      END;

      INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
      SELECT feed_items.id, feed_items.title, feed_items.summary, feeds.title
      FROM feed_items JOIN feeds ON feeds.id = feed_items.feed_id;
    `,
  },
  {
    version: 7,
    name: 'user-auth-rename',
    sql: `
      ALTER TABLE owner_auth RENAME TO user_auth;
    `,
  },
  {
    version: 8,
    name: 'feed-home-page-url',
    sql: `
      ALTER TABLE feeds ADD COLUMN home_page_url TEXT;
    `,
  },
  {
    version: 9,
    name: 'refetch-feeds-for-home-page',
    sql: `
      UPDATE feeds SET etag = NULL, last_modified = NULL;
    `,
  },
  {
    version: 10,
    name: 'subscription-custom-title',
    sql: `
      ALTER TABLE subscriptions ADD COLUMN custom_title TEXT
        CHECK (custom_title IS NULL OR length(custom_title) BETWEEN 1 AND 512);
    `,
  },
  {
    version: 11,
    name: 'feed-description',
    sql: `
      ALTER TABLE feeds ADD COLUMN description TEXT
        CHECK (description IS NULL OR length(description) BETWEEN 1 AND 1024);

      -- Dropping the validators makes the next poll unconditional, so existing
      -- Feeds report their description without waiting for the document to change.
      UPDATE feeds SET etag = NULL, last_modified = NULL;
    `,
  },
]

const MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL
  );
`

/** Versions already recorded in this database, ascending. */
export function appliedVersions(db: SqliteDatabase): number[] {
  db.exec(MIGRATION_TABLE)
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
    version: number
  }>
  return rows.map((row) => row.version)
}

/**
 * Each migration runs in its own transaction, so a failure leaves the database at the
 * last complete version.
 */
export function applyMigrations(
  db: SqliteDatabase,
  clock: Clock = systemClock,
  pending: readonly Migration[] = migrations,
): number[] {
  const already = new Set(appliedVersions(db))
  const applied: number[] = []

  for (const migration of pending) {
    if (already.has(migration.version)) continue

    const run = db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        clock.now().toISOString(),
      )
    })
    run()
    applied.push(migration.version)
  }

  return applied
}
