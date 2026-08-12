import { eq, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { BetterSQLite3Database, BetterSQLiteTransaction } from 'drizzle-orm/better-sqlite3'
import { feedItems, feeds, feedUrlAliases, subscriptions } from '../persistence/schema.js'
import type { NormalizedFeedItem, ParsedFeedDocument } from './feed-document.js'

type EmptySchema = Record<string, never>
export type DatabaseTransaction = BetterSQLiteTransaction<EmptySchema, ExtractTablesWithRelations<EmptySchema>>

/**
 * Returns false — writing nothing — when the Subscription is gone by the time the
 * retrieval lands: unsubscribing takes effect immediately, and an in-flight poll
 * must not resurrect what the User let go of.
 */
export function persistFeedWindow(
  db: BetterSQLite3Database,
  options: {
    feedId: number
    parsed: ParsedFeedDocument
    resolvedUrl: string
    /**
     * Stored verbatim, including absence, so a stale `ETag` is never replayed
     * after a publisher stops sending one.
     */
    validators: { etag: string | null; lastModified: string | null }
    now: string
  },
): boolean {
  const { feedId, parsed, resolvedUrl, validators, now } = options
  const domain = new URL(resolvedUrl).hostname
  return db.transaction((tx) => {
    const subscribed = tx
      .select({ feedId: subscriptions.feedId })
      .from(subscriptions)
      .where(eq(subscriptions.feedId, feedId))
      .limit(1)
      .all()[0]
    if (!subscribed) return false

    const alias = tx
      .select({ feedId: feedUrlAliases.feedId })
      .from(feedUrlAliases)
      .where(eq(feedUrlAliases.url, resolvedUrl))
      .limit(1)
      .all()[0]
    if (alias && alias.feedId !== feedId) throw new Error('Resolved Feed URL belongs to another Feed')

    tx.insert(feedUrlAliases).values({ url: resolvedUrl, feedId }).onConflictDoNothing().run()
    tx.update(feeds)
      .set({
        title: parsed.title,
        domain,
        resolvedUrl,
        etag: validators.etag,
        lastModified: validators.lastModified,
        updatedAt: now,
      })
      .where(eq(feeds.id, feedId))
      .run()
    for (const item of parsed.items) upsertFeedItem(tx, feedId, item, now)
    return true
  })
}

/** Re-ingestion corrects mutable metadata; identity, first-seen time, and Library membership stay untouched. */
export function upsertFeedItem(tx: DatabaseTransaction, feedId: number, item: NormalizedFeedItem, now: string): void {
  tx.insert(feedItems)
    .values({
      feedId,
      dedupeKey: item.dedupeKey,
      identityKind: item.identityKind,
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt,
      imageUrl: item.imageUrl,
      summary: item.summary,
      firstSeenAt: now,
      lastObservedAt: now,
    })
    .onConflictDoUpdate({
      target: [feedItems.feedId, feedItems.dedupeKey],
      set: {
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
        imageUrl: item.imageUrl,
        summary: item.summary,
        lastObservedAt: now,
      },
    })
    .run()
}
