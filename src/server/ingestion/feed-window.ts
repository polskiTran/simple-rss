import { eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '../persistence/database.js'
import { feedItems, feeds, feedUrlAliases } from '../persistence/schema.js'
import type { ParsedFeedDocument } from './feed-document.js'

/**
 * Writes one Feed Window and the Feed metadata it reports, inside the caller's
 * transaction — the caller has already confirmed the Feed is still subscribed.
 * Re-ingesting an item corrects its mutable metadata; identity, first-seen time,
 * and Library membership stay untouched.
 */
export function persistFeedWindow(
  tx: DatabaseTransaction,
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
): void {
  const { feedId, parsed, resolvedUrl, validators, now } = options
  const domain = new URL(parsed.homePageUrl ?? resolvedUrl).hostname
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
      description: parsed.description,
      domain,
      homePageUrl: parsed.homePageUrl,
      resolvedUrl,
      etag: validators.etag,
      lastModified: validators.lastModified,
      updatedAt: now,
    })
    .where(eq(feeds.id, feedId))
    .run()
  for (const item of parsed.items) {
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
        feedContentMarkdown: item.feedContent?.markdown ?? null,
        feedContentTruncated: item.feedContent?.truncated ? 1 : 0,
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
          feedContentMarkdown: item.feedContent?.markdown ?? null,
          feedContentTruncated: item.feedContent?.truncated ? 1 : 0,
          lastObservedAt: now,
        },
      })
      .run()
  }
}
