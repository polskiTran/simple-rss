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
