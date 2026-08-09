import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type SqliteDatabase = Database.Database

/** How long a writer waits for a competing write before giving up. */
const BUSY_TIMEOUT_MS = 5_000

/**
 * Opens the single SQLite database this installation owns, configured the way
 * `docs/ARCHITECTURE.md` requires: WAL, a busy timeout, and foreign keys.
 *
 * The caller passes an absolute path below the durable data directory. Missing
 * parent directories are created because a freshly mounted volume is empty.
 */
export function openDatabase(path: string): SqliteDatabase {
  mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  return db
}

/**
 * Proves the volume is writable rather than merely present. A read-only or
 * full volume opens fine and only fails on the first write, so readiness
 * performs a real write against a single reused row. Throws on failure.
 */
export function assertWritable(db: SqliteDatabase, now: Date): void {
  db.prepare('INSERT OR REPLACE INTO write_probe (id, checked_at) VALUES (1, ?)').run(now.toISOString())
}
