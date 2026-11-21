import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { count, sql } from 'drizzle-orm'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Clock } from '../clock.js'
import { assertWritable, type DrizzleDatabase, openDatabase } from './database.js'
import { applyMigrations } from './migrations.js'
import { feedItems, feeds, libraryItems, subscriptions, userAuth } from './schema.js'

function sidecarsOf(path: string): string[] {
  return [`${path}-wal`, `${path}-shm`]
}

export interface SnapshotWriteReport {
  readonly bytes: number
}

export function writeSnapshot(source: string, destination: string): SnapshotWriteReport {
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
      db.run(sql`VACUUM INTO ${partial}`)
    } finally {
      db.$client.close()
    }

    renameSync(partial, destination)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }

  return { bytes: statSync(destination).size }
}

export interface RestoreReport {
  readonly restored: true
  readonly migrationsApplied: number
  readonly indexedItems: number
  readonly feeds: number
  readonly subscriptions: number
  readonly feedItems: number
  readonly libraryItems: number
  readonly claimed: boolean
}

export function restoreSnapshot(
  backupPath: string,
  databasePath: string,
  options: { clock: Clock; rebuildIndex: (db: DrizzleDatabase) => number },
): RestoreReport {
  const { clock, rebuildIndex } = options

  if (!existsSync(backupPath)) {
    throw new Error(`there is no backup at ${backupPath}`)
  }
  if (existsSync(databasePath)) {
    throw new Error(`${databasePath} already exists; restore only initializes a fresh data directory`)
  }
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
      if (db.get<{ integrity_check: string }>(sql`PRAGMA integrity_check`)?.integrity_check !== 'ok') {
        throw new Error('the snapshot failed its integrity check')
      }
      const migrationsApplied = applyMigrations(db, clock).length
      const indexedItems = rebuildIndex(db)
      assertWritable(db, clock.now())

      report = {
        restored: true,
        migrationsApplied,
        indexedItems,
        feeds: countRows(db, feeds),
        subscriptions: countRows(db, subscriptions),
        feedItems: countRows(db, feedItems),
        libraryItems: countRows(db, libraryItems),
        claimed: countRows(db, userAuth) > 0,
      }
    } finally {
      db.$client.close()
    }

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

function countRows(db: DrizzleDatabase, table: AnySQLiteTable): number {
  return db.select({ count: count() }).from(table).get()?.count ?? 0
}
