import { and, eq, isNull, or } from 'drizzle-orm'
import type { Logger } from '../logger.js'
import type { DatabaseTransaction, DrizzleDatabase } from '../persistence/database.js'
import { feeds, feedUrlAliases, subscriptions } from '../persistence/schema.js'
import { loggableUrl } from './loggable-url.js'

/** The form every Feed URL is compared in: HTTP(S), no credentials, no fragment. Undefined when it is not one. */
export function canonicalFeedUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

/** The subscribed Feed that `url` is one of the addresses of, if any. */
export function subscribedFeedId(db: DrizzleDatabase | DatabaseTransaction, url: string): number | undefined {
  return db
    .select({ feedId: subscriptions.feedId })
    .from(feedUrlAliases)
    .innerJoin(subscriptions, eq(subscriptions.feedId, feedUrlAliases.feedId))
    .where(eq(feedUrlAliases.url, url))
    .limit(1)
    .all()[0]?.feedId
}

/**
 * Records a Subscription for a canonical URL no subscribed Feed holds, due
 * immediately with every preference left to the column defaults. A retained
 * Feed holding the URL is revived under the same row — so Library items keep
 * the identity they were saved from — reclaiming the URL's alias if a merge
 * had moved it away. Otherwise a new Feed is named by its URL's host, or the
 * offered title, until a retrieval reports its own. Returns the Feed's id.
 */
export function recordSubscription(
  tx: DatabaseTransaction,
  logger: Logger,
  feed: { enteredUrl: string; requestedUrl: string; offeredTitle?: string | null; now: string },
): number {
  const { enteredUrl, requestedUrl, offeredTitle, now } = feed
  const dormant = dormantFeedId(tx, requestedUrl, enteredUrl)
  if (dormant !== undefined) {
    tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId: dormant }).onConflictDoNothing().run()
    tx.insert(subscriptions).values({ feedId: dormant, nextPollAt: now, createdAt: now }).run()
    logger.info('subscriptions.subscription_created', {
      feedId: dormant,
      enteredUrl: loggableUrl(enteredUrl),
      revived: true,
    })
    return dormant
  }

  const domain = new URL(requestedUrl).hostname
  const inserted = tx
    .insert(feeds)
    .values({
      enteredUrl,
      resolvedUrl: requestedUrl,
      title: offeredTitle?.trim() || domain,
      domain,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  const feedId = Number(inserted.lastInsertRowid)
  tx.insert(feedUrlAliases).values({ url: requestedUrl, feedId }).run()
  tx.insert(subscriptions).values({ feedId, nextPollAt: now, createdAt: now }).run()
  logger.info('subscriptions.subscription_created', { feedId, enteredUrl: loggableUrl(enteredUrl) })
  return feedId
}

/**
 * An unsubscribed Feed holding a URL a new Feed would claim. Its aliases come
 * first; a duplicate whose aliases a merge moved away is still found by its
 * own URLs, which stay reserved until Retention retires the row.
 */
function dormantFeedId(tx: DatabaseTransaction, requestedUrl: string, enteredUrl: string): number | undefined {
  const unsubscribed = isNull(subscriptions.feedId)
  return (
    tx
      .select({ feedId: feeds.id })
      .from(feedUrlAliases)
      .innerJoin(feeds, eq(feeds.id, feedUrlAliases.feedId))
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(feedUrlAliases.url, requestedUrl), unsubscribed))
      .limit(1)
      .all()[0]?.feedId ??
    tx
      .select({ feedId: feeds.id })
      .from(feeds)
      .leftJoin(subscriptions, eq(subscriptions.feedId, feeds.id))
      .where(and(or(eq(feeds.enteredUrl, enteredUrl), eq(feeds.resolvedUrl, requestedUrl)), unsubscribed))
      .limit(1)
      .all()[0]?.feedId
  )
}
