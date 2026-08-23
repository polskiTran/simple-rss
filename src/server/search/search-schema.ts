import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Query-side typing for the FTS5 index. Migrations 6 and 12 own its DDL and the
 * triggers that keep it synchronized; it stays out of persistence/schema.ts,
 * whose enforced mirror covers ordinary tables only.
 */
export const feedItemSearch = sqliteTable('feed_item_search', {
  rowid: integer('rowid').notNull(),
  itemTitle: text('item_title'),
  summary: text('summary'),
  feedTitle: text('feed_title'),
})
