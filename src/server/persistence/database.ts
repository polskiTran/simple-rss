import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type SQLite from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { writeProbe } from './schema.js'

/** The one database handle used throughout the process. */
export type DrizzleDatabase = BetterSQLite3Database & { readonly $client: SQLite.Database }

const BUSY_TIMEOUT_MS = 5_000

export function openDatabase(path: string): DrizzleDatabase {
  mkdirSync(dirname(path), { recursive: true })

  const db = drizzle(path)
  db.$client.pragma('journal_mode = WAL')
  db.$client.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
  db.$client.pragma('foreign_keys = ON')
  db.$client.pragma('synchronous = NORMAL')
  return db
}

/**
 * A read-only or full volume opens fine and only fails on the first write, so
 * readiness performs a real write against a single reused row. Throws on failure.
 */
export function assertWritable(db: DrizzleDatabase, now: Date): void {
  db.insert(writeProbe)
    .values({ id: 1, checkedAt: now.toISOString() })
    .onConflictDoUpdate({
      target: writeProbe.id,
      set: { checkedAt: now.toISOString() },
    })
    .run()
}
