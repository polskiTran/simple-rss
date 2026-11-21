import { timeLabel } from '../calendar.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const RELEASE_DATE_TIME = 'T00:00:00.000Z'
const RELEASE_DATE_PLACE = 'T12:00:00.000Z'

export const FEED_ITEM_CHRONOLOGY_SQL = `CASE
  WHEN published_at IS NULL THEN first_seen_at
  WHEN substr(published_at, 11) = '${RELEASE_DATE_TIME}' THEN
    CASE
      WHEN substr(published_at, 1, 10) || '${RELEASE_DATE_PLACE}' <= strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at, '+1 day')
      THEN substr(published_at, 1, 10) || '${RELEASE_DATE_PLACE}'
      ELSE first_seen_at
    END
  WHEN published_at <= strftime('%Y-%m-%dT%H:%M:%fZ', first_seen_at, '+1 day') THEN published_at
  ELSE first_seen_at
END`

export function feedItemChronologyAt(publishedAt: string | null, firstSeenAt: string): string {
  if (publishedAt === null) return firstSeenAt
  const placed = publishedAt.endsWith(RELEASE_DATE_TIME)
    ? `${publishedAt.slice(0, 10)}${RELEASE_DATE_PLACE}`
    : publishedAt
  const horizon = new Date(Date.parse(firstSeenAt) + DAY_MS).toISOString()
  return placed <= horizon ? placed : firstSeenAt
}

export function displayTimeOf(
  item: { readonly publishedAt: string | null; readonly chronologyAt: string },
  timezone: string,
): string | null {
  const releaseDate =
    item.publishedAt?.endsWith(RELEASE_DATE_TIME) &&
    item.chronologyAt === `${item.publishedAt.slice(0, 10)}${RELEASE_DATE_PLACE}`
  return releaseDate ? null : timeLabel(new Date(item.chronologyAt), timezone)
}
