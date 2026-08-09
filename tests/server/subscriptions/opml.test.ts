import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_OPML_FEEDS,
  OpmlError,
  parseOpml,
  serializeOpml,
} from '../../../src/server/subscriptions/opml.js'

const FIXTURES = join(import.meta.dirname, '../../fixtures/opml')

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8')
}

describe('parseOpml', () => {
  it('collects Feed outlines in document order across nesting, folders, and attribute casing', () => {
    expect(parseOpml(fixture('nested-subscriptions.opml'))).toEqual([
      { url: 'https://journal.example/feed', title: 'Field Notes' },
      { url: 'https://atom.example/feed.xml', title: 'Atom Letters' },
      { url: 'https://uppercase.example/feed', title: 'Shouting exporter' },
    ])
  })

  it('keeps the first occurrence when one document repeats a Feed URL', () => {
    const outlines = parseOpml(fixture('nested-subscriptions.opml'))
    expect(outlines.filter((outline) => outline.url === 'https://journal.example/feed')).toEqual([
      { url: 'https://journal.example/feed', title: 'Field Notes' },
    ])
  })

  it('rejects malformed XML as malformed_opml', () => {
    expect(() => parseOpml(fixture('malformed.opml'))).toThrowError(
      expect.objectContaining({ name: 'OpmlError', code: 'malformed_opml' }),
    )
  })

  it('rejects XML that is not an OPML document as unsupported_opml', () => {
    expect(() => parseOpml(fixture('not-opml.xml'))).toThrowError(
      expect.objectContaining({ name: 'OpmlError', code: 'unsupported_opml' }),
    )
  })

  it('rejects XML able to declare external entities before parsing', () => {
    const hostile = `<?xml version="1.0"?>
      <!DOCTYPE opml [<!ENTITY leak SYSTEM "file:///etc/passwd">]>
      <opml version="2.0"><body><outline xmlUrl="https://a.example/feed"/></body></opml>`
    expect(() => parseOpml(hostile)).toThrowError(
      expect.objectContaining({ name: 'OpmlError', code: 'unsupported_opml' }),
    )
  })

  it('refuses a document listing more Feeds than one import will process', () => {
    const outlines = Array.from(
      { length: MAX_OPML_FEEDS + 1 },
      (_, index) => `<outline xmlUrl="https://feeds.example/${index}"/>`,
    ).join('')
    expect(() => parseOpml(`<opml version="2.0"><body>${outlines}</body></opml>`)).toThrowError(
      expect.objectContaining({ name: 'OpmlError', code: 'too_many_feeds' }),
    )
  })

  it('yields no Feeds for an OPML document holding only folders', () => {
    expect(parseOpml('<opml version="2.0"><body><outline text="Empty folder"/></body></opml>')).toEqual([])
  })

  it('exposes the failure as a typed OpmlError', () => {
    try {
      parseOpml('nonsense')
      expect.unreachable('parseOpml accepted nonsense')
    } catch (error) {
      expect(error).toBeInstanceOf(OpmlError)
    }
  })
})

describe('serializeOpml', () => {
  it('writes active Subscriptions as standard outlines another reader can import', () => {
    const opml = serializeOpml(
      [
        { title: 'Field Notes', resolvedUrl: 'https://feeds.example/journal.xml' },
        { title: 'Atom Letters', resolvedUrl: 'https://atom.example/feed.xml' },
      ],
      new Date('2026-08-08T09:00:00.000Z'),
    )

    expect(opml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(opml).toContain('<opml version="2.0">')
    expect(opml).toContain(
      '<outline type="rss" text="Field Notes" title="Field Notes" xmlUrl="https://feeds.example/journal.xml"/>',
    )
    expect(opml).toContain(
      '<outline type="rss" text="Atom Letters" title="Atom Letters" xmlUrl="https://atom.example/feed.xml"/>',
    )
    expect(opml).toContain('<dateCreated>Sat, 08 Aug 2026 09:00:00 GMT</dateCreated>')
  })

  it('escapes titles and URLs so a hostile Feed title cannot break the document', () => {
    const opml = serializeOpml(
      [{ title: 'Tom & Jerry\'s "notes" <best>', resolvedUrl: 'https://feeds.example/a?b=1&c=2' }],
      new Date('2026-08-08T09:00:00.000Z'),
    )

    expect(opml).toContain('text="Tom &amp; Jerry&apos;s &quot;notes&quot; &lt;best&gt;"')
    expect(opml).toContain('xmlUrl="https://feeds.example/a?b=1&amp;c=2"')
    expect(parseOpml(opml)).toEqual([
      { url: 'https://feeds.example/a?b=1&c=2', title: 'Tom & Jerry\'s "notes" <best>' },
    ])
  })

  it('round trips: its own export parses back to the same Feeds', () => {
    const subscriptions = [
      { title: 'Field Notes', resolvedUrl: 'https://feeds.example/journal.xml' },
      { title: 'Atom Letters', resolvedUrl: 'https://atom.example/feed.xml' },
    ]
    expect(parseOpml(serializeOpml(subscriptions, new Date()))).toEqual([
      { url: 'https://feeds.example/journal.xml', title: 'Field Notes' },
      { url: 'https://atom.example/feed.xml', title: 'Atom Letters' },
    ])
  })
})
