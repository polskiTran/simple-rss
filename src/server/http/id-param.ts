import type { Context } from 'hono'
import type { z } from 'zod'
import { notFound, type Validated } from './responses.js'

/**
 * Validates a path parameter, answering `404` itself: an identifier this
 * installation could never have issued and one it does not hold are one answer.
 */
export function readIdParam<S extends z.ZodTypeAny>(c: Context, name: string, schema: S): Validated<z.infer<S>> {
  const parsed = schema.safeParse(c.req.param(name))
  if (!parsed.success) return { ok: false, response: notFound(c) }
  return { ok: true, value: parsed.data }
}
