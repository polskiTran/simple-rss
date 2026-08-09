/**
 * Guards and shapes shared by the two untrusted-XML entry points — Feed
 * documents and OPML uploads — so hardening one cannot drift from the other.
 */

const FORBIDDEN_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/i

/**
 * Whether the document carries a DOCTYPE or ENTITY declaration — the two
 * constructs able to smuggle external entities in, refused before parsing.
 */
export function declaresXmlEntities(text: string): boolean {
  return FORBIDDEN_DECLARATION.test(text)
}

export function arrayOf(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
