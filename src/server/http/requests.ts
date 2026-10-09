import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'
import { idParameterSchema, type ApiErrorBody, type ApiErrorCode } from '../../shared/api.js'
import { decodeListCursor, type ListCursor } from '../digest/list-page.js'

/** What a request reader hands back: a value it accepted, or the response refusing it. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response }

/** Every API refusal goes out through here, so its code is one the contract lists. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  headers?: Record<string, string>,
): Response {
  return c.json<ApiErrorBody>({ error: { code, message } }, status, headers)
}

export function notFound(c: Context): Response {
  return apiError(c, 404, 'not_found', 'Not found')
}

/**
 * Reads a Feed or Feed Item identifier from the path, answering `404` itself:
 * an identifier this installation could never have issued and one it does not
 * hold are one answer.
 */
export function readId(c: Context, name: string): Validated<number> {
  const parsed = idParameterSchema.safeParse(c.req.param(name))
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, response: notFound(c) }
}

/**
 * Validates a JSON body, answering `400` itself. Failure messages name fields
 * and constraints, never values — one route through here carries the password.
 */
export async function readJsonBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<Validated<z.infer<S>>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return { ok: false, response: apiError(c, 400, 'invalid_request', 'Body must be JSON') }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: apiError(c, 400, 'invalid_request', describe(parsed.error)) }
  }

  return { ok: true, value: parsed.data }
}

/** Absent means the top of the list. An undecodable cursor is answered 400 here. */
export function readListCursor(c: Context): Validated<ListCursor | undefined> {
  const raw = c.req.query('cursor')
  if (raw === undefined) return { ok: true, value: undefined }

  const cursor = decodeListCursor(raw)
  return cursor
    ? { ok: true, value: cursor }
    : { ok: false, response: apiError(c, 400, 'invalid_cursor', 'The cursor is not one this installation issued') }
}

function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`).join('; ')
}
