import { systemClock, type Clock } from '../clock.js'
import type { SqliteDatabase } from './database.js'

export interface Migration {
  /** 1-based, contiguous, and never reused or reordered once released. */
  readonly version: number
  readonly name: string
  readonly sql: string
}

/**
 * Every schema change this installation has ever made, in order. Migrations
 * are literal SQL rather than generated diffs so that a reviewer can read
 * exactly what will run against an Owner's volume, and so that the compiled
 * server carries them without shipping loose `.sql` files.
 *
 * Migrations are append-only. Correct a released migration with a new one.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'installation-foundation',
    sql: `
      -- The single row describing this installation. The CHECK keeps the
      -- singleton honest instead of relying on every caller to remember.
      CREATE TABLE installation_settings (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        timezone   TEXT    NOT NULL,
        created_at TEXT    NOT NULL,
        updated_at TEXT    NOT NULL
      );

      -- Readiness writes here to prove the mounted volume still accepts
      -- writes. One row, rewritten in place, so it never grows.
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
      -- The Owner's single password verifier. One row, like the installation
      -- it belongs to: its presence is what "claimed" means, so the CHECK is
      -- what makes a second Owner unrepresentable rather than merely refused.
      CREATE TABLE owner_auth (
        id            INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT    NOT NULL,
        claimed_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );

      -- One row per signed-in device. The token itself is never stored: the
      -- primary key is its SHA-256, so a copy of the volume does not hand
      -- anyone a working cookie.
      --
      -- Two deadlines, both absolute instants: last_seen_at moves forward as
      -- the device is used and drives the idle timeout, while expires_at is
      -- fixed at issue and cannot be extended by using the session.
      CREATE TABLE sessions (
        token_hash   TEXT PRIMARY KEY,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL
      );

      -- Pruning sweeps by deadline, so it must not scan every row.
      CREATE INDEX sessions_expires_at ON sessions (expires_at);
    `,
  },
  {
    version: 3,
    name: 'feeds-subscriptions-and-items',
    sql: `
      -- A Feed is publisher-owned metadata and retrieval identity. The URL the
      -- Owner entered and the last validated redirect target are deliberately
      -- separate: provenance must survive an ordinary Feed migration.
      CREATE TABLE feeds (
        id           INTEGER PRIMARY KEY,
        entered_url  TEXT NOT NULL UNIQUE,
        resolved_url TEXT NOT NULL UNIQUE,
        title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
        domain       TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      -- Canonical request and resolved URLs share one uniqueness namespace.
      -- This closes the gap two independent UNIQUE columns would leave when
      -- one Feed's entered URL is another Feed's redirect target.
      CREATE TABLE feed_url_aliases (
        url     TEXT PRIMARY KEY,
        feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE
      );
      CREATE INDEX feed_url_aliases_feed_id ON feed_url_aliases (feed_id);

      -- The Owner's choice to include a Feed. It is not folded into feeds:
      -- future unsubscribe must be able to stop polling without erasing Feed
      -- attribution held by a Library item.
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

      -- Library membership is separate and intentionally untouched by Feed
      -- Item metadata upserts.
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
      -- Retrieval validators live with the Feed, whose publisher issued them.
      -- They let the next poll ask "anything new?" instead of re-downloading.
      ALTER TABLE feeds ADD COLUMN etag TEXT;
      ALTER TABLE feeds ADD COLUMN last_modified TEXT;

      -- The persisted due-time frontier. Backfilled from created_at so every
      -- Subscription that predates this migration is immediately due and the
      -- scheduler's first wake catches it up.
      ALTER TABLE subscriptions ADD COLUMN next_poll_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
      ALTER TABLE subscriptions ADD COLUMN last_polled_at TEXT;
      UPDATE subscriptions SET next_poll_at = created_at;

      -- The scheduler queries this frontier once a minute; it must not scan.
      CREATE INDEX subscriptions_next_poll_at ON subscriptions (next_poll_at);
    `,
  },
  {
    version: 5,
    name: 'feed-availability',
    sql: `
      -- Feed Availability state, kept with the Subscription it describes.
      -- last_polled_at already records the most recent completed attempt;
      -- these columns say how it went and how the run of failures stands.
      --
      -- Nothing is backfilled: pre-migration polls never recorded outcomes,
      -- so last_success_at starts honest at NULL and fills in on the next
      -- successful poll rather than claiming a success nobody observed.
      ALTER TABLE subscriptions ADD COLUMN last_success_at TEXT;
      ALTER TABLE subscriptions ADD COLUMN last_failure_at TEXT;
      ALTER TABLE subscriptions ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_failures >= 0);

      -- The safe failure vocabulary, constrained here so no code path can
      -- persist a raw error message where a category belongs.
      ALTER TABLE subscriptions ADD COLUMN last_failure_category TEXT
        CHECK (last_failure_category IN
          ('unreachable', 'timeout', 'too_large', 'unsupported_content', 'http_error', 'invalid_feed'));
    `,
  },
  {
    version: 6,
    name: 'feed-item-search',
    sql: `
      -- The search index over retained reading metadata: each retained Feed
      -- Item's title, its normalized plain-text summary, and the title of the
      -- Feed that published it. Article bodies are never stored, so they can
      -- never be indexed. The table is derived state — rebuildable from the
      -- canonical tables at any time and excluded from portable export.
      CREATE VIRTUAL TABLE feed_item_search USING fts5(
        item_title,
        summary,
        feed_title,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- Maintenance is triggers rather than application code, so every way a
      -- Feed Item row changes — ingestion upserts, retention pruning,
      -- unsubscribe cleanup, cascading Feed deletion, a future restore — keeps
      -- the index current without each caller remembering to. A pruned item
      -- leaves the index in the same transaction that removes its row, which
      -- is what stops a derived index from outliving retention.
      CREATE TRIGGER feed_item_search_after_insert AFTER INSERT ON feed_items BEGIN
        INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
        VALUES (new.id, new.title, new.summary, (SELECT title FROM feeds WHERE id = new.feed_id));
      END;

      -- Re-observation touches every item each poll; only a real metadata
      -- correction is worth rewriting the indexed row for.
      CREATE TRIGGER feed_item_search_after_update AFTER UPDATE ON feed_items
      WHEN old.title IS NOT new.title OR old.summary IS NOT new.summary BEGIN
        DELETE FROM feed_item_search WHERE rowid = old.id;
        INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
        VALUES (new.id, new.title, new.summary, (SELECT title FROM feeds WHERE id = new.feed_id));
      END;

      CREATE TRIGGER feed_item_search_after_delete AFTER DELETE ON feed_items BEGIN
        DELETE FROM feed_item_search WHERE rowid = old.id;
      END;

      -- A corrected Feed title reaches every indexed item it attributes.
      CREATE TRIGGER feed_item_search_after_feed_rename AFTER UPDATE OF title ON feeds
      WHEN old.title IS NOT new.title BEGIN
        UPDATE feed_item_search SET feed_title = new.title
        WHERE rowid IN (SELECT id FROM feed_items WHERE feed_id = new.id);
      END;

      -- Items retained from before this migration are indexed once, here.
      INSERT INTO feed_item_search (rowid, item_title, summary, feed_title)
      SELECT feed_items.id, feed_items.title, feed_items.summary, feeds.title
      FROM feed_items JOIN feeds ON feeds.id = feed_items.feed_id;
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
 * Brings the database up to the latest schema and returns the versions it
 * actually applied. Each migration runs in its own transaction, so a failure
 * leaves the database at the last complete version rather than half-migrated.
 *
 * Runs before the server reports ready; a throw here must keep readiness shut.
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
