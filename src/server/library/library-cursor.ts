import { Buffer } from 'node:buffer'
import { z } from 'zod'

/** Where the next Library page resumes: the last item's save, as stored ISO, and its id to break ties. */
export interface LibraryCursor {
  readonly savedAt: string
  readonly feedItemId: number
}

export function encodeLibraryCursor(cursor: LibraryCursor): string {
  return Buffer.from(JSON.stringify([cursor.savedAt, cursor.feedItemId]), 'utf8').toString('base64url')
}

const STORED_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const libraryCursorSchema = z.tuple([
  z
    .string()
    .regex(STORED_ISO_INSTANT)
    .refine((value) => Number.isFinite(Date.parse(value))),
  z.number().int().positive(),
])

/** `undefined` for anything this module never issued. */
export function decodeLibraryCursor(value: string): LibraryCursor | undefined {
  try {
    const parsed = libraryCursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    if (!parsed.success) return undefined
    const [savedAt, feedItemId] = parsed.data
    return { savedAt, feedItemId }
  } catch {
    return undefined
  }
}
