import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { arrayOf, asRecord, declaresXmlEntities } from '../ingestion/xml.js'

/**
 * The most Feeds one OPML import will record. Recording is local (ADR 0007),
 * so this bounds parse work and the scheduler's first-check backlog.
 */
export const MAX_OPML_FEEDS = 500

const MAX_TITLE_LENGTH = 512

/** One Feed another reader listed: the URL to retrieve and the name it gave. */
export interface OpmlFeedOutline {
  readonly url: string
  readonly title: string | null
}

export type OpmlFailureCode = 'malformed_opml' | 'unsupported_opml' | 'too_many_feeds'

export class OpmlError extends Error {
  readonly code: OpmlFailureCode

  constructor(code: OpmlFailureCode, message: string) {
    super(message)
    this.name = 'OpmlError'
    this.code = code
  }
}

/**
 * Extracts the Feeds an uploaded OPML document lists, in document order, with
 * one entry per distinct URL however often the document repeats it.
 *
 * Outlines without an `xmlUrl` are folders or plain links, not Feeds, and are
 * walked through rather than reported. URLs are returned as written — each one
 * goes through the normal Subscription creation path, which owns validation.
 */
export function parseOpml(text: string): readonly OpmlFeedOutline[] {
  if (declaresXmlEntities(text)) {
    throw new OpmlError('unsupported_opml', 'OPML DOCTYPE and ENTITY declarations are unsupported')
  }
  if (XMLValidator.validate(text) !== true) {
    throw new OpmlError('malformed_opml', 'OPML XML is malformed')
  }

  let document: unknown
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: true,
    }).parse(text)
  } catch {
    throw new OpmlError('malformed_opml', 'OPML XML could not be parsed')
  }

  const opml = asRecord(asRecord(document)['opml'])
  if (Object.keys(opml).length === 0) {
    throw new OpmlError('unsupported_opml', 'The document is not an OPML subscription list')
  }

  const feeds = new Map<string, OpmlFeedOutline>()
  collectFeeds(asRecord(opml['body'])['outline'], feeds)
  return [...feeds.values()]
}

/**
 * Writes the User's active Subscriptions as an OPML 2.0 document. Each
 * outline carries `type`, `text`, `title`, and `xmlUrl` — the standard
 * metadata other readers import from — with the resolved URL, because it is
 * the endpoint that currently answers.
 */
export function serializeOpml(
  subscriptions: readonly { readonly title: string; readonly resolvedUrl: string }[],
  now: Date,
): string {
  const outlines = subscriptions.map(
    (subscription) =>
      `    <outline type="rss" text="${escapeAttribute(subscription.title)}" ` +
      `title="${escapeAttribute(subscription.title)}" xmlUrl="${escapeAttribute(subscription.resolvedUrl)}"/>`,
  )

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Simple RSS Subscriptions</title>',
    `    <dateCreated>${now.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n')
}

function collectFeeds(outline: unknown, feeds: Map<string, OpmlFeedOutline>): void {
  for (const node of arrayOf(outline)) {
    const record = asRecord(node)
    const url = attributeIgnoringCase(record, 'xmlUrl')
    if (url && !feeds.has(url)) {
      if (feeds.size >= MAX_OPML_FEEDS) {
        throw new OpmlError('too_many_feeds', `One import processes at most ${MAX_OPML_FEEDS} Feeds`)
      }
      const title = attributeIgnoringCase(record, 'title') ?? attributeIgnoringCase(record, 'text')
      feeds.set(url, { url, title: title ? title.slice(0, MAX_TITLE_LENGTH) : null })
    }
    collectFeeds(record['outline'], feeds)
  }
}

/** OPML in the wild disagrees on attribute casing; `xmlUrl` and `XMLURL` both occur. */
function attributeIgnoringCase(record: Record<string, unknown>, name: string): string | null {
  const wanted = `@_${name}`.toLowerCase()
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== wanted) continue
    if (typeof value !== 'string') return null
    const text = value.trim()
    return text || null
  }
  return null
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
