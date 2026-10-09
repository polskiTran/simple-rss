import { Buffer } from 'node:buffer'
import { sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { feedItems } from '../persistence/schema.js'

export const LIST_PAGE_SIZE = 50

export interface ListCursor {
  /**
   * The last item's ordering instant, as stored ISO: its save in the Library,
   * its chronology in `DigestService.after()`.
   */
  readonly instant: string
  readonly feedItemId: number
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.instant, cursor.feedItemId]), 'utf8').toString('base64url')
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
    const [instant, feedItemId] = parsed.data
    return { instant, feedItemId }
  } catch {
    return undefined
  }
}

/**
 * Rows strictly beyond the cursor along `ordering`: newest first by default,
 * so older, ties to lower id; oldest first, the mirror.
 */
export function beyondCursorSql(
  ordering: SQL | SQLiteColumn,
  cursor: ListCursor,
  direction: 'newest' | 'oldest' = 'newest',
): SQL {
  return direction === 'newest'
    ? sql`(${ordering} < ${cursor.instant}
    OR (${ordering} = ${cursor.instant} AND ${feedItems.id} < ${cursor.feedItemId}))`
    : sql`(${ordering} > ${cursor.instant}
    OR (${ordering} = ${cursor.instant} AND ${feedItems.id} > ${cursor.feedItemId}))`
}
