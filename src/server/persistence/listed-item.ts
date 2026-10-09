import { feedItems, libraryItems } from './schema.js'

/**
 * The columns a list of Feed Items reads each one by — the Digest, an opened
 * Feed, Search, and Reader View. The query left-joins `libraryItems` on the
 * Feed Item, so `savedAt` is null for an item outside the Library. `chronologyAt`
 * is for the caller's ordering and day labels; `listedItemOf` does not answer it.
 */
export const LISTED_ITEM_COLUMNS = {
  feedItemId: feedItems.id,
  title: feedItems.title,
  publishedAt: feedItems.publishedAt,
  firstSeenAt: feedItems.firstSeenAt,
  chronologyAt: feedItems.chronologyAt,
  savedAt: libraryItems.savedAt,
}

export interface ListedItemRow {
  readonly feedItemId: number
  readonly title: string | null
  readonly publishedAt: string | null
  readonly firstSeenAt: string
  readonly chronologyAt: string
  readonly savedAt: string | null
}

/** The fields every listed Feed Item answers alike: an untitled item reads `Untitled`, a saved one says so. */
export function listedItemOf(row: ListedItemRow) {
  return {
    feedItemId: row.feedItemId,
    title: row.title ?? 'Untitled',
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    saved: row.savedAt !== null,
  }
}
