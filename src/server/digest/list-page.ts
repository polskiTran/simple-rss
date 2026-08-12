import { Buffer } from 'node:buffer'
import { sql, type SQL } from 'drizzle-orm'
import { feedItems } from '../persistence/schema.js'
import { plausibleHorizon } from './chronology.js'

// Digest and Library pages resume by keyset cursor (the last item's chronology instant
// and id, the two sort keys); an offset would drift as polling inserts at the top.
// The client only echoes the cursor back; its contents are this module's business alone.

export const LIST_PAGE_SIZE = 50

export interface ListCursor {
  /** The resolved chronology instant of the last item shown, as stored ISO. */
  readonly chronology: string
  readonly feedItemId: number
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.chronology, cursor.feedItemId]), 'utf8').toString('base64url')
}

// Exactly `toISOString()` output. The SQL keyset filter compares instants as
// text, which is only a time comparison between strings of this one shape.
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** `undefined` for anything this module never issued. */
export function decodeListCursor(value: string): ListCursor | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined

  const [chronology, feedItemId] = parsed as [unknown, unknown]
  if (typeof chronology !== 'string' || !CURSOR_INSTANT.test(chronology) || !Number.isFinite(Date.parse(chronology)))
    return undefined
  if (typeof feedItemId !== 'number' || !Number.isSafeInteger(feedItemId) || feedItemId <= 0) return undefined
  return { chronology, feedItemId }
}

/** Null when the one-past-the-page fetch came back short and the list is over. */
export function nextListCursor(
  fetchedCount: number,
  last: { readonly row: { readonly feedItemId: number }; readonly chronology: number } | undefined,
): string | null {
  return fetchedCount > LIST_PAGE_SIZE && last
    ? encodeListCursor({ chronology: new Date(last.chronology).toISOString(), feedItemId: last.row.feedItemId })
    : null
}

/**
 * The chronology rule as SQL, so ORDER BY and the keyset filter act before the LIMIT.
 * Stored instants are normalized ISO-8601 UTC, so text comparison is time comparison.
 */
export function chronologySql(now: Date): SQL {
  return sql`CASE
    WHEN ${feedItems.publishedAt} IS NOT NULL AND ${feedItems.publishedAt} <= ${plausibleHorizon(now)}
    THEN ${feedItems.publishedAt}
    ELSE ${feedItems.firstSeenAt}
  END`
}

/** Rows strictly beyond the cursor in Digest order: older, ties to lower id. */
export function beyondCursorSql(chronology: SQL, cursor: ListCursor): SQL {
  return sql`(${chronology} < ${cursor.chronology}
    OR (${chronology} = ${cursor.chronology} AND ${feedItems.id} < ${cursor.feedItemId}))`
}
