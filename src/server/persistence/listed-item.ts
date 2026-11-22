import { sql } from 'drizzle-orm'
import { UNTITLED_FEED_ITEM_TITLE } from '../../shared/api.js'
import { feedItems } from './schema.js'

export const LISTED_ITEM_COLUMNS = {
  feedItemId: feedItems.id,
  title: feedItems.title,
  publishedAt: feedItems.publishedAt,
  firstSeenAt: feedItems.firstSeenAt,
  chronologyAt: feedItems.chronologyAt,
  savedAt: sql<string | null>`(SELECT saved_at FROM library_items WHERE library_items.feed_item_id = feed_items.id)`,
}

export interface ListedItemRow {
  readonly feedItemId: number
  readonly title: string | null
  readonly publishedAt: string | null
  readonly firstSeenAt: string
  readonly chronologyAt: string
  readonly savedAt: string | null
}

export function listedItemOf(row: ListedItemRow) {
  return {
    feedItemId: row.feedItemId,
    title: row.title ?? UNTITLED_FEED_ITEM_TITLE,
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    saved: row.savedAt !== null,
  }
}
