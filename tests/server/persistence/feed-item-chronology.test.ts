import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { feedItemChronologyAt } from '../../../src/server/persistence/feed-item-chronology.js'
import { openDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations, migrations } from '../../../src/server/persistence/migrations.js'
import { feedItems } from '../../../src/server/persistence/schema.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

const CASES = [
  {
    dedupeKey: 'on-the-day',
    publishedAt: '2026-08-09T09:00:00.000Z',
    firstSeenAt: '2026-08-08T09:00:00.000Z',
    chronologyAt: '2026-08-09T09:00:00.000Z',
  },
  {
    dedupeKey: 'one-millisecond-past',
    publishedAt: '2026-08-09T09:00:00.001Z',
    firstSeenAt: '2026-08-08T09:00:00.000Z',
    chronologyAt: '2026-08-08T09:00:00.000Z',
  },
  {
    dedupeKey: 'undated',
    publishedAt: null,
    firstSeenAt: '2026-08-08T09:00:00.000Z',
    chronologyAt: '2026-08-08T09:00:00.000Z',
  },
  {
    dedupeKey: 'earlier',
    publishedAt: '2026-08-08T07:00:00.000Z',
    firstSeenAt: '2026-08-08T09:00:00.000Z',
    chronologyAt: '2026-08-08T07:00:00.000Z',
  },
  {
    dedupeKey: 'far-ahead',
    publishedAt: '2026-09-01T00:00:00.000Z',
    firstSeenAt: '2026-08-08T09:00:00.000Z',
    chronologyAt: '2026-08-08T09:00:00.000Z',
  },
  {
    dedupeKey: 'half-second',
    publishedAt: '2026-08-09T23:30:00.500Z',
    firstSeenAt: '2026-08-08T23:30:00.500Z',
    chronologyAt: '2026-08-09T23:30:00.500Z',
  },
  {
    dedupeKey: 'half-second-past',
    publishedAt: '2026-08-09T23:30:00.501Z',
    firstSeenAt: '2026-08-08T23:30:00.500Z',
    chronologyAt: '2026-08-08T23:30:00.500Z',
  },
] as const

function flat(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function chunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object' || !('value' in chunk) || !Array.isArray(chunk.value)) return ''
  return chunk.value.join('')
}

function declaredChronologySql(): string {
  const column = getTableConfig(feedItems).columns.find((entry) => entry.name === 'chronology_at')
  if (!column?.generated) throw new Error('chronology_at is not a generated column')
  return column.generated.as.queryChunks.map(chunkText).join('')
}

describe('Feed Item chronology', () => {
  it('uses the released generated expression in the schema', () => {
    const migration = migrations.find((entry) => entry.version === 16)
    const expression = /GENERATED ALWAYS AS \(([\s\S]*?)\)\s*VIRTUAL/u.exec(migration?.sql ?? '')
    if (!expression?.[1]) throw new Error('migration 16 has no chronology expression')

    expect(flat(declaredChronologySql())).toBe(flat(expression[1]))
  })

  it('agrees with the generated column on literal publication times', async () => {
    const db = openDatabase(join(await makeTempDataDir(), 'simple-rss.db'))
    applyMigrations(db)
    db.$client
      .prepare(`INSERT INTO feeds (id, entered_url, resolved_url, title, domain, created_at, updated_at)
        VALUES (1, 'https://journal.example/feed', 'https://journal.example/feed', 'Field Notes', 'journal.example', '2026-01-01', '2026-01-01')`)
      .run()
    const insert = db.$client.prepare(`INSERT INTO feed_items
      (feed_id, dedupe_key, identity_kind, published_at, first_seen_at, last_observed_at)
      VALUES (1, ?, 'guid', ?, ?, ?)`)
    for (const row of CASES) insert.run(row.dedupeKey, row.publishedAt, row.firstSeenAt, row.firstSeenAt)

    const stored = db.$client.prepare('SELECT dedupe_key, chronology_at FROM feed_items ORDER BY id').all() as {
      dedupe_key: string
      chronology_at: string
    }[]
    expect(stored).toEqual(CASES.map((row) => ({ dedupe_key: row.dedupeKey, chronology_at: row.chronologyAt })))
    expect(CASES.map((row) => feedItemChronologyAt(row.publishedAt, row.firstSeenAt))).toEqual(
      CASES.map((row) => row.chronologyAt),
    )
    db.$client.close()
  })
})
