import { join } from 'node:path'
import { is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { type DrizzleDatabase, openDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations } from '../../../src/server/persistence/migrations.js'
import * as schema from '../../../src/server/persistence/schema.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

/**
 * Holds schema.ts' columns to a fully migrated database, so a query never names a
 * column the migrations did not create, nor types or defaults one differently.
 * Constraints and indexes belong to migrations alone and are not compared.
 *
 * Outside the comparison: `schema_migrations` (the runner's own ledger) and
 * `feed_item_search` with its FTS5 shadow tables, typed in search/search-schema.ts.
 */

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

const declared = Object.values<unknown>(schema).filter((value): value is SQLiteTable => is(value, SQLiteTable))

let db: DrizzleDatabase

beforeAll(async () => {
  db = openDatabase(join(await makeTempDataDir(), 'simple-rss.db'))
  applyMigrations(db)
  return () => db.$client.close()
})

/** `120` and `0` come back bare; strings come back single-quoted, matching pragma output. */
function literalOf(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  return String(value)
}

describe('schema.ts against the migrated database', () => {
  it('declares exactly the tables the migrations create', () => {
    const migrated = db.$client
      .prepare(`SELECT name FROM sqlite_master
   WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     AND name != 'schema_migrations' AND name NOT LIKE 'feed_item_search%'`)
      .pluck()
      .all()

    expect(declared.map((table) => getTableConfig(table).name).sort()).toEqual(migrated.sort())
  })

  it('declares every column: name, type, nullability, primary key, and default', () => {
    for (const table of declared) {
      const config = getTableConfig(table)
      const actual = db.$client.prepare(`PRAGMA table_xinfo(${config.name})`).all() as ColumnInfo[]
      const actualByName = new Map(actual.map((column) => [column.name, column]))

      expect(config.columns.map((column) => column.name).sort(), config.name).toEqual([...actualByName.keys()].sort())

      for (const column of config.columns) {
        const real = actualByName.get(column.name)
        if (!real) continue
        const at = `${config.name}.${column.name}`

        expect(column.getSQLType().toLowerCase(), at).toBe(real.type.toLowerCase())
        expect(column.primary, at).toBe(real.pk > 0)
        // SQLite leaves even a PRIMARY KEY column's notnull flag at 0.
        if (real.pk === 0) expect(column.notNull, at).toBe(real.notnull === 1)
        expect(literalOf(column.default), at).toBe(real.dflt_value)
      }
    }
  })
})
