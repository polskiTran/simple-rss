import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { convert } from 'html-to-text'
import { arrayOf, asRecord, declaresXmlEntities } from './xml.js'

const MAX_TITLE_LENGTH = 512
const MAX_SUMMARY_LENGTH = 20_000

export type FeedItemIdentityKind = 'guid' | 'link' | 'content'

export interface NormalizedFeedItem {
  readonly dedupeKey: string
  readonly identityKind: FeedItemIdentityKind
  readonly title: string | null
  readonly link: string | null
  readonly publishedAt: string | null
  readonly imageUrl: string | null
  readonly summary: string | null
}

export interface ParsedFeedDocument {
  readonly title: string
  readonly items: readonly NormalizedFeedItem[]
}

export type FeedDocumentFailureCode = 'malformed_feed' | 'unsupported_feed'

export class FeedDocumentError extends Error {
  readonly code: FeedDocumentFailureCode

  constructor(code: FeedDocumentFailureCode, message: string) {
    super(message)
    this.name = 'FeedDocumentError'
    this.code = code
  }
}

/**
 * Turns untrusted RSS or Atom bytes into the bounded metadata Simple RSS keeps.
 * XML declarations able to introduce external entities are rejected before
 * parsing; publisher HTML is converted to plain text and never leaves here.
 */
export function parseFeedDocument(bytes: Uint8Array, resolvedUrl: string): ParsedFeedDocument {
  const xml = decodeXml(bytes)
  if (declaresXmlEntities(xml)) {
    throw new FeedDocumentError('unsupported_feed', 'Feed DOCTYPE and ENTITY declarations are unsupported')
  }

  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    throw new FeedDocumentError('malformed_feed', 'Feed XML is malformed')
  }

  let document: unknown
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      trimValues: false,
      processEntities: true,
      stopNodes: [
        '*.title',
        '*.atom:title',
        '*.description',
        '*.summary',
        '*.atom:summary',
        '*.content',
        '*.atom:content',
        '*.content:encoded',
      ],
    }).parse(xml)
  } catch {
    throw new FeedDocumentError('malformed_feed', 'Feed XML could not be parsed')
  }

  const root = asRecord(document)
  const rss = recordField(root, ['rss'])
  if (rss) return parseRss(rss, resolvedUrl)

  const atom = recordField(root, ['feed', 'atom:feed'])
  if (atom) return parseAtom(atom, resolvedUrl)

  const rdf = recordField(root, ['rdf:RDF', 'RDF'])
  if (rdf) return parseRdf(rdf, resolvedUrl)

  throw new FeedDocumentError('unsupported_feed', 'The document is not an RSS or Atom Feed')
}

function parseRss(root: unknown, baseUrl: string): ParsedFeedDocument {
  const channel = recordField(asRecord(root), ['channel'])
  if (!channel) throw new FeedDocumentError('malformed_feed', 'RSS is missing its channel')

  const record = asRecord(channel)
  const title = requiredFeedTitle(recordField(record, ['title']), baseUrl)
  const items = arrayOf(recordField(record, ['item'])).map((item) => normalizeItem(asRecord(item), baseUrl, false))
  return { title, items }
}

function parseAtom(root: unknown, baseUrl: string): ParsedFeedDocument {
  const record = asRecord(root)
  const title = requiredFeedTitle(recordField(record, ['title', 'atom:title']), baseUrl)
  const entries = recordField(record, ['entry', 'atom:entry'])
  const items = arrayOf(entries).map((entry) => normalizeItem(asRecord(entry), baseUrl, true))
  return { title, items }
}

function parseRdf(root: unknown, baseUrl: string): ParsedFeedDocument {
  const record = asRecord(root)
  const channel = asRecord(recordField(record, ['channel']))
  if (Object.keys(channel).length === 0) {
    throw new FeedDocumentError('malformed_feed', 'RSS 1.0 is missing its channel')
  }

  const title = requiredFeedTitle(recordField(channel, ['title']), baseUrl)
  const items = arrayOf(recordField(record, ['item'])).map((item) => normalizeItem(asRecord(item), baseUrl, false))
  return { title, items }
}

function normalizeItem(record: Record<string, unknown>, baseUrl: string, atom: boolean): NormalizedFeedItem {
  const title = boundedPlainText(recordField(record, ['title', 'atom:title']), MAX_TITLE_LENGTH)
  const summary = boundedPlainText(
    recordField(record, atom ? ['summary', 'content', 'atom:summary', 'atom:content'] : ['description', 'content:encoded']),
    MAX_SUMMARY_LENGTH,
  )
  const link = normalizeHttpUrl(atom ? atomLink(record, 'alternate') : recordField(record, ['link']), baseUrl)
  const publishedAt = normalizeDate(
    recordField(record, atom ? ['published', 'updated', 'atom:published', 'atom:updated'] : ['pubDate', 'dc:date']),
  )
  const imageUrl = normalizeHttpUrl(imageOf(record, atom), baseUrl)
  const guid = plainValue(recordField(record, atom ? ['id', 'atom:id'] : ['guid']))

  // The content fingerprint deliberately leaves the summary out: it is the
  // field publishers correct most, and hashing it would turn every correction
  // into a new identity instead of an update to the existing Feed Item.
  const identity = guid
    ? { kind: 'guid' as const, key: `guid:${guid}` }
    : link
      ? { kind: 'link' as const, key: `link:${link}` }
      : {
          kind: 'content' as const,
          key: `content:${createHash('sha256')
            .update(JSON.stringify([title, publishedAt]))
            .digest('hex')}`,
        }

  return {
    dedupeKey: identity.key,
    identityKind: identity.kind,
    title,
    link,
    publishedAt,
    imageUrl,
    summary,
  }
}

function imageOf(record: Record<string, unknown>, atom: boolean): unknown {
  const media = recordField(record, ['media:content', 'media:thumbnail'])
  const mediaUrl = attributeOf(arrayOf(media).find((candidate) => {
    const entry = asRecord(candidate)
    const medium = plainValue(entry['@_medium'])
    const type = plainValue(entry['@_type'])
    return medium === 'image' || type?.startsWith('image/') || (!medium && !type)
  }), 'url')
  if (mediaUrl) return mediaUrl

  const enclosure = atom ? atomLinkElement(record, 'enclosure') : recordField(record, ['enclosure'])
  const enclosureRecord = asRecord(enclosure)
  const enclosureType = plainValue(enclosureRecord['@_type'])
  return enclosureType?.startsWith('image/') ? enclosureRecord['@_url'] ?? enclosureRecord['@_href'] : undefined
}

function atomLink(record: Record<string, unknown>, relationship: string): unknown {
  const selected = atomLinkElement(record, relationship)
  return asRecord(selected)['@_href'] ?? selected
}

/** The whole `<link>` element, for callers that need its other attributes. */
function atomLinkElement(record: Record<string, unknown>, relationship: string): unknown {
  const links = arrayOf(recordField(record, ['link', 'atom:link']))
  return (
    links.find((candidate) => plainValue(asRecord(candidate)['@_rel']) === relationship) ??
    (relationship === 'alternate'
      ? links.find((candidate) => !plainValue(asRecord(candidate)['@_rel']))
      : undefined)
  )
}

function requiredFeedTitle(value: unknown, baseUrl: string): string {
  return boundedPlainText(value, MAX_TITLE_LENGTH) ?? new URL(baseUrl).hostname
}

function normalizeHttpUrl(value: unknown, baseUrl: string): string | null {
  const raw = plainValue(value)
  if (!raw) return null

  try {
    const url = new URL(raw, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.username = ''
    url.password = ''
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function normalizeDate(value: unknown): string | null {
  const raw = plainValue(value)
  if (!raw) return null
  const time = Date.parse(raw)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function boundedPlainText(value: unknown, limit: number): string | null {
  const raw = plainValue(value)
  if (!raw) return null

  // Stop nodes arrive raw. CDATA already wraps literal markup, but outside it
  // the XML entities are still encoded — `&lt;p&gt;` is markup to interpret,
  // not text — so they get one decode before the HTML-to-text pass.
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw)
  const source = cdata ? cdata[1]! : decodeXmlEntities(raw)

  const text = convert(source, {
    wordwrap: false,
    preserveNewlines: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  })
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return null
  return text.slice(0, limit)
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
}

/** The five XML entities plus numeric references; anything else stays as written. */
function decodeXmlEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (entity, hex, decimal, named) => {
    if (typeof named === 'string') return NAMED_ENTITIES[named] ?? entity
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10)
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return entity
    }
  })
}

function plainValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text || null
  }

  if (Array.isArray(value)) {
    const text = value
      .map((candidate) => plainValue(candidate))
      .filter((candidate): candidate is string => candidate !== null)
      .join(' ')
      .trim()
    return text || null
  }

  const fragments: string[] = []
  for (const [name, child] of Object.entries(asRecord(value))) {
    if (name.startsWith('@_')) continue
    const localName = name.split(':').at(-1)?.toLowerCase()
    if (localName === 'script' || localName === 'style' || localName === 'img') continue
    const text = plainValue(child)
    if (text) fragments.push(text)
  }
  const text = fragments.join(' ').trim()
  return text || null
}

function attributeOf(value: unknown, name: string): string | null {
  return plainValue(asRecord(value)[`@_${name}`])
}

function recordField(record: Record<string, unknown>, names: readonly string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined) return record[name]
  }
  return undefined
}

function decodeXml(bytes: Uint8Array): string {
  const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.byteLength, 256)))
  const declared = /^\s*<\?xml[^>]*\bencoding=["']([^"']+)["']/i.exec(prefix)?.[1]

  try {
    return new TextDecoder(declared ?? 'utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new FeedDocumentError('malformed_feed', 'Feed text encoding is invalid or unsupported')
  }
}
