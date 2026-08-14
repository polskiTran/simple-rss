import type { Context } from 'hono'
import type { z } from 'zod'

export type BodyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response }

/**
 * Validates a JSON body, answering `400` itself. Failure messages name fields
 * and constraints, never values — one route through here carries the password.
 */
export async function readJsonBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<BodyResult<z.infer<S>>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return { ok: false, response: invalid(c, 'Body must be JSON') }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: invalid(c, describe(parsed.error)) }
  }

  return { ok: true, value: parsed.data }
}

function invalid(c: Context, message: string): Response {
  return c.json({ error: { code: 'invalid_request', message } }, 400, { 'Cache-Control': 'no-store' })
}

function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`).join('; ')
}
