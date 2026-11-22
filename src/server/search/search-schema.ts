import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const feedItemSearch = sqliteTable('feed_item_search', {
  rowid: integer('rowid').notNull(),
  itemTitle: text('item_title'),
  summary: text('summary'),
  feedTitle: text('feed_title'),
})

export const SEARCHED_COLUMNS = ['item_title', 'summary', 'feed_title'] as const
export type SearchedColumn = (typeof SEARCHED_COLUMNS)[number]
