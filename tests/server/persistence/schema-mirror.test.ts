import { join } from 'node:path'
import { is } from 'drizzle-orm'
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type SqliteDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations } from '../../../src/server/persistence/migrations.js'
import * as schema from '../../../src/server/persistence/schema.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

/**
 * The drift test behind schema.ts' "typed mirror" claim: migrations stay the
 * source of truth, and this walks a fully migrated database to prove the mirror
 * still matches it — tables, columns, defaults, foreign keys, indexes, unique
 * groups, and CHECK expressions. Index column *direction* is the one thing
 * pragmas don't expose, so the chronology indexes' DESC is not compared;
 * partial-index WHERE clauses are also outside the comparison, and no index
 * declares one today.
 *
 * Deliberately outside the comparison: `schema_migrations` (the runner's own
 * ledger) and `feed_item_search` with its FTS5 shadow tables — search DDL
 * belongs to migrations 6 and 12 and is queried through search/, not mirrored.
 */

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

interface IndexInfo {
  name: string
  unique: number
  origin: 'c' | 'u' | 'pk'
}

const mirrored = Object.values<unknown>(schema).filter((value): value is SQLiteTable => is(value, SQLiteTable))

let db: SqliteDatabase

beforeAll(async () => {
  db = openDatabase(join(await makeTempDataDir(), 'simple-rss.db'))
  applyMigrations(db)
  return () => db.close()
})

function migratedTables(): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         AND name != 'schema_migrations' AND name NOT LIKE 'feed_item_search%'`,
    )
    .all() as Array<{ name: string; sql: string }>
  return new Map(rows.map((row) => [row.name, row.sql]))
}

/** `120` and `0` come back bare; strings come back single-quoted, matching pragma output. */
function literalOf(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  return String(value)
}

describe('the schema mirror', () => {
  it('names exactly the tables the migrations create', () => {
    const mirroredNames = mirrored.map((table) => getTableConfig(table).name).sort()

    expect(mirroredNames).toEqual([...migratedTables().keys()].sort())
  })

  it('mirrors every column: name, type, nullability, primary key, and default', () => {
    for (const table of mirrored) {
      const config = getTableConfig(table)
      const actual = db.prepare(`PRAGMA table_info(${config.name})`).all() as ColumnInfo[]
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

  it('mirrors foreign keys and their delete behavior', () => {
    for (const table of mirrored) {
      const config = getTableConfig(table)
      const actual = db.prepare(`PRAGMA foreign_key_list(${config.name})`).all() as Array<{
        table: string
        from: string
        to: string
        on_delete: string
      }>

      const declared = config.foreignKeys.map((fk) => {
        const reference = fk.reference()
        return {
          table: getTableConfig(reference.foreignTable).name,
          from: reference.columns.map((column) => column.name).join(','),
          to: reference.foreignColumns.map((column) => column.name).join(','),
          on_delete: (fk.onDelete ?? 'no action').toUpperCase(),
        }
      })
      const real = actual.map((fk) => ({
        table: fk.table,
        from: fk.from,
        to: fk.to,
        on_delete: fk.on_delete,
      }))

      expect(
        declared.sort((a, b) => a.from.localeCompare(b.from)),
        config.name,
      ).toEqual(real.sort((a, b) => a.from.localeCompare(b.from)))
    }
  })

  it('mirrors every created index by name, columns, and uniqueness', () => {
    for (const table of mirrored) {
      const config = getTableConfig(table)
      const listed = db.prepare(`PRAGMA index_list(${config.name})`).all() as IndexInfo[]

      const created = listed
        .filter((entry) => entry.origin === 'c')
        .map((entry) => ({
          name: entry.name,
          unique: entry.unique === 1,
          columns: columnsOfIndex(entry.name),
        }))
      const declared = config.indexes.map((index) => ({
        name: index.config.name,
        unique: index.config.unique,
        columns: index.config.columns.map((column) => ('name' in column ? column.name : String(column))),
      }))

      expect(declared.sort(byName), config.name).toEqual(created.sort(byName))
    }
  })

  it('mirrors every unique column group', () => {
    for (const table of mirrored) {
      const config = getTableConfig(table)
      const listed = db.prepare(`PRAGMA index_list(${config.name})`).all() as IndexInfo[]

      const real = listed.filter((entry) => entry.origin === 'u').map((entry) => columnsOfIndex(entry.name).join(','))
      const declared = [
        ...config.uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name).join(',')),
        ...config.columns.filter((column) => column.isUnique).map((column) => column.name),
      ]

      expect(declared.sort(), config.name).toEqual(real.sort())
    }
  })

  it('mirrors every CHECK constraint expression', () => {
    const dialect = new SQLiteSyncDialect()
    const tables = migratedTables()

    for (const table of mirrored) {
      const config = getTableConfig(table)

      const real = checkExpressionsOf(tables.get(config.name) ?? '').map((expression) =>
        comparableExpression(expression, config.name),
      )
      const declared = config.checks.map((check) => {
        const query = dialect.sqlToQuery(check.value)
        expect(query.params, `${config.name}: a check expression must not carry bound parameters`).toEqual([])
        return comparableExpression(query.sql, config.name)
      })

      expect(declared.sort(), config.name).toEqual(real.sort())
    }
  })
})

function columnsOfIndex(name: string): string[] {
  const rows = db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ seqno: number; name: string }>
  return rows.sort((a, b) => a.seqno - b.seqno).map((row) => row.name)
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name)
}

/** The expression inside each CHECK(...), tracked through nested parentheses. */
function checkExpressionsOf(createSql: string): string[] {
  const expressions: string[] = []
  const opener = /CHECK\s*\(/gi

  let match = opener.exec(createSql)
  while (match) {
    let depth = 1
    let index = opener.lastIndex
    while (index < createSql.length && depth > 0) {
      if (createSql[index] === '(') depth += 1
      else if (createSql[index] === ')') depth -= 1
      index += 1
    }
    expressions.push(createSql.slice(opener.lastIndex, index - 1))
    match = opener.exec(createSql)
  }
  return expressions
}

/** Lowercased, quote- and table-prefix-free, whitespace-collapsed — the shape both sides share. */
function comparableExpression(expression: string, tableName: string): string {
  return expression.toLowerCase().replaceAll('"', '').replaceAll(`${tableName}.`, '').replace(/\s+/g, ' ').trim()
}
