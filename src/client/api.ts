import { serviceMetaSchema, type ServiceMeta } from '../shared/api.js'

/**
 * Same-origin JSON calls, validated against the schemas the server answers
 * with. The client never trusts a response shape it has not parsed.
 *
 * Network loss surfaces as a rejected promise, which views render as an
 * explicit unavailable state — the application never pretends to be offline.
 */
async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`)
  }
  return parse(await response.json())
}

export function fetchServiceMeta(): Promise<ServiceMeta> {
  return getJson('/api/meta', (value) => serviceMetaSchema.parse(value))
}
