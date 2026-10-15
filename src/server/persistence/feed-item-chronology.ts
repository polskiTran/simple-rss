const DAY_MS = 24 * 60 * 60 * 1_000

export const FEED_ITEM_CHRONOLOGY_SQL = `CASE
  WHEN published_at IS NOT NULL
    AND published_at <= strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at, '+1 day')
  THEN published_at
  ELSE first_seen_at
END`

export function feedItemChronologyAt(publishedAt: string | null, firstSeenAt: string): string {
  const horizon = new Date(Date.parse(firstSeenAt) + DAY_MS).toISOString()
  return publishedAt !== null && publishedAt <= horizon ? publishedAt : firstSeenAt
}
