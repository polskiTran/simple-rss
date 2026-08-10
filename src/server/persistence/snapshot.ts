import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Clock } from '../clock.js'
import { rebuildSearchIndex } from '../search/search-service.js'
import { assertWritable, openDatabase, type SqliteDatabase } from './database.js'
import { applyMigrations } from './migrations.js'

/**
 * The snapshot side of persistence: writing an application-consistent copy of
 * the live database, and initializing a fresh data directory from one.
 *
 * Both operations stage their work under a temporary name and rename into
 * place only once every step has passed, so a file at the final path is
 * always a finished artifact. Every failure throws with an operator-readable
 * reason after the staging files are removed.
 */

/** Files SQLite may hold beside a database, which travel or block as a set. */
function sidecarsOf(path: string): string[] {
  return [`${path}-wal`, `${path}-shm`]
}

/**
 * Writes a snapshot of the database at `source` to `destination`. `VACUUM
 * INTO` produces a compacted, transaction-consistent copy even while the WAL
 * is active, which is what makes this safe where a raw file copy of an open
 * database is not.
 *
 * An existing destination is never overwritten, because the backup an
 * operator is replacing is the one they need if this run fails.
 */
export function writeSnapshot(source: string, destination: string): { bytes: number } {
  if (!existsSync(source)) {
    throw new Error(`there is no database at ${source} to back up`)
  }
  if (existsSync(destination)) {
    throw new Error(`${destination} already exists; back up to a new path instead of overwriting one`)
  }

  const partial = `${destination}.partial`
  try {
    mkdirSync(dirname(destination), { recursive: true })
    rmSync(partial, { force: true })

    const db = openDatabase(source)
    try {
      db.prepare('VACUUM INTO ?').run(partial)
    } finally {
      db.close()
    }

    renameSync(partial, destination)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }

  return { bytes: statSync(destination).size }
}

/** What a completed restore left on the volume, for the operator to verify. */
export interface RestoreReport {
  readonly restored: true
  readonly migrationsApplied: number[]
  readonly indexedItems: number
  readonly feeds: number
  readonly subscriptions: number
  readonly feedItems: number
  readonly libraryItems: number
  readonly claimed: boolean
}

/**
 * Initializes an empty data directory from a snapshot. All verification —
 * integrity, migrations, the derived search rebuild, a real write — happens
 * on a staging copy that is renamed to `databasePath` only after everything
 * passed, so a failed restore leaves the directory uninitialized and the
 * service unready rather than serving half a database.
 *
 * Migrations run here so a backup taken on an older release comes forward to
 * the schema this build serves; the FTS index is rebuilt rather than trusted,
 * because derived state is this installation's to derive.
 */
export function restoreSnapshot(backupPath: string, databasePath: string, clock: Clock): RestoreReport {
  if (!existsSync(backupPath)) {
    throw new Error(`there is no backup at ${backupPath}`)
  }
  if (existsSync(databasePath)) {
    throw new Error(`${databasePath} already exists; restore only initializes a fresh data directory`)
  }
  // A stray sidecar from an earlier database would be adopted by the restored
  // one and override its contents, so it disqualifies the directory too.
  for (const sidecar of sidecarsOf(databasePath)) {
    if (existsSync(sidecar)) {
      throw new Error(`${sidecar} already exists; restore only initializes a fresh data directory`)
    }
  }

  const staging = `${databasePath}.restoring`
  const stagingFiles = [staging, ...sidecarsOf(staging)]
  let report: RestoreReport
  try {
    mkdirSync(dirname(databasePath), { recursive: true })
    for (const leftover of stagingFiles) rmSync(leftover, { force: true })
    copyFileSync(backupPath, staging)

    const db = openDatabase(staging)
    try {
      if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('the snapshot failed its integrity check')
      }
      const migrationsApplied = applyMigrations(db, clock)
      const indexedItems = rebuildSearchIndex(db)
      assertWritable(db, clock.now())

      report = {
        restored: true,
        migrationsApplied,
        indexedItems,
        feeds: countRows(db, 'feeds'),
        subscriptions: countRows(db, 'subscriptions'),
        feedItems: countRows(db, 'feed_items'),
        libraryItems: countRows(db, 'library_items'),
        claimed: countRows(db, 'user_auth') > 0,
      }
    } finally {
      db.close()
    }

    // Closing checkpoints the WAL and removes the sidecars. If one survived,
    // renaming the main file alone would silently shed the migrations and
    // rebuilt index committed above — so a leftover fails the restore instead.
    for (const sidecar of sidecarsOf(staging)) {
      if (existsSync(sidecar)) {
        throw new Error('the staging copy left WAL sidecars behind')
      }
    }

    renameSync(staging, databasePath)
  } catch (error) {
    for (const leftover of stagingFiles) rmSync(leftover, { force: true })
    throw error
  }

  return report
}

function countRows(
  db: SqliteDatabase,
  table: 'feeds' | 'subscriptions' | 'feed_items' | 'library_items' | 'user_auth',
): number {
  return (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count
}
