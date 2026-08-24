import { Buffer } from 'node:buffer'
import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { feedItems } from '../persistence/schema.js'
import { plausibleHorizon } from './chronology.js'

export const LIST_PAGE_SIZE = 50

export interface ListCursor {
  /** The resolved chronology instant of the last item shown, as stored ISO. */
  readonly chronology: string
  readonly feedItemId: number
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.chronology, cursor.feedItemId]), 'utf8').toString('base64url')
}

const STORED_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const listCursorSchema = z.tuple([
  z
    .string()
    .regex(STORED_ISO_INSTANT)
    .refine((value) => Number.isFinite(Date.parse(value))),
  z.number().int().positive(),
])

/** `undefined` for anything this module never issued. */
export function decodeListCursor(value: string): ListCursor | undefined {
  try {
    const parsed = listCursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    if (!parsed.success) return undefined
    const [chronology, feedItemId] = parsed.data
    return { chronology, feedItemId }
  } catch {
    return undefined
  }
}

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
