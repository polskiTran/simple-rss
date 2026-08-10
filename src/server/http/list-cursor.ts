import type { Context } from 'hono'
import { decodeListCursor, type ListCursor } from '../digest/list-page.js'
import { NO_STORE } from './responses.js'

type ListCursorQuery =
  | { readonly ok: true; readonly cursor: ListCursor | undefined }
  | { readonly ok: false; readonly response: Response }

/**
 * The `cursor` query parameter as a paged list route reads it: absent means
 * the top of the list, a value the reader issued resumes it, and anything
 * else is answered 400 here so both the Digest and the Library refuse a
 * foreign cursor in the same words.
 */
export function readListCursor(c: Context): ListCursorQuery {
  const raw = c.req.query('cursor')
  if (raw === undefined) return { ok: true, cursor: undefined }

  const cursor = decodeListCursor(raw)
  if (!cursor) {
    return {
      ok: false,
      response: c.json(
        { error: { code: 'invalid_cursor', message: 'The cursor is not one this installation issued' } },
        400,
        NO_STORE,
      ),
    }
  }
  return { ok: true, cursor }
}
