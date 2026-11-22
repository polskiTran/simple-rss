import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { MAX_FEED_TITLE_LENGTH } from '../../shared/api.js'
import { arrayOf, asRecord, declaresXmlEntities } from '../ingestion/xml.js'

export const MAX_OPML_FEEDS = 500

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

  const opml = asRecord(asRecord(document).opml)
  if (Object.keys(opml).length === 0) {
    throw new OpmlError('unsupported_opml', 'The document is not an OPML subscription list')
  }

  const feeds = new Map<string, OpmlFeedOutline>()
  collectFeeds(asRecord(opml.body).outline, feeds)
  return [...feeds.values()]
}

export function serializeOpml(
  subscriptions: readonly {
    readonly title: string
    readonly description: string | null
    readonly resolvedUrl: string
  }[],
  now: Date,
): string {
  const outlines = subscriptions.map(
    (subscription) =>
      `    <outline type="rss" text="${escapeAttribute(subscription.title)}" ` +
      `title="${escapeAttribute(subscription.title)}" ` +
      (subscription.description === null ? '' : `description="${escapeAttribute(subscription.description)}" `) +
      `xmlUrl="${escapeAttribute(subscription.resolvedUrl)}"/>`,
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
      feeds.set(url, { url, title: title ? title.slice(0, MAX_FEED_TITLE_LENGTH) : null })
    }
    collectFeeds(record.outline, feeds)
  }
}

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
