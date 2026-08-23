import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { feedUrlAliases, subscriptions } from '../persistence/schema.js'

/** The URL as the aliases table keys it: http(s) only, no credentials, fragment dropped. */
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

export interface AliasOwner {
  readonly feedId: number
  /** False for a dormant Feed: its row survives for Library attribution, its Subscription row is gone. */
  readonly subscribed: boolean
}

/** The Feed the first of `urls` that is an alias belongs to; undefined when none is. */
export function aliasOwnerOf(db: BetterSQLite3Database, ...urls: readonly string[]): AliasOwner | undefined {
  for (const url of urls) {
    const row = db
      .select({ feedId: feedUrlAliases.feedId, subscribedFeedId: subscriptions.feedId })
      .from(feedUrlAliases)
      .leftJoin(subscriptions, eq(subscriptions.feedId, feedUrlAliases.feedId))
      .where(eq(feedUrlAliases.url, url))
      .limit(1)
      .all()[0]
    if (row) return { feedId: row.feedId, subscribed: row.subscribedFeedId !== null }
  }
  return undefined
}
