import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { feedUrlAliases, subscriptions } from '../persistence/schema.js'

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
  readonly subscribed: boolean
}

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
