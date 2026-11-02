import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOpml, serializeOpml } from '../../../src/server/subscriptions/opml.js'

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

  it('yields no Feeds for an OPML document holding only folders', () => {
    expect(parseOpml('<opml version="2.0"><body><outline text="Empty folder"/></body></opml>')).toEqual([])
  })
})

describe('serializeOpml', () => {
  it('writes active Subscriptions as standard outlines another reader can import', () => {
    const opml = serializeOpml(
      [
        { title: 'Field Notes', description: 'Notes from the field', resolvedUrl: 'https://feeds.example/journal.xml' },
        { title: 'Atom Letters', description: null, resolvedUrl: 'https://atom.example/feed.xml' },
      ],
      new Date('2026-08-08T09:00:00.000Z'),
    )

    expect(opml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(opml).toContain('<opml version="2.0">')
    expect(opml).toContain(
      '<outline type="rss" text="Field Notes" title="Field Notes" ' +
        'description="Notes from the field" xmlUrl="https://feeds.example/journal.xml"/>',
    )
    expect(opml).toContain(
      '<outline type="rss" text="Atom Letters" title="Atom Letters" xmlUrl="https://atom.example/feed.xml"/>',
    )
    expect(opml).toContain('<dateCreated>Sat, 08 Aug 2026 09:00:00 GMT</dateCreated>')
  })

  it('escapes titles and URLs so a hostile Feed title cannot break the document', () => {
    const opml = serializeOpml(
      [
        {
          title: 'Tom & Jerry\'s "notes" <best>',
          description: 'Cat & mouse, "daily"',
          resolvedUrl: 'https://feeds.example/a?b=1&c=2',
        },
      ],
      new Date('2026-08-08T09:00:00.000Z'),
    )

    expect(opml).toContain('text="Tom &amp; Jerry&apos;s &quot;notes&quot; &lt;best&gt;"')
    expect(opml).toContain('description="Cat &amp; mouse, &quot;daily&quot;"')
    expect(opml).toContain('xmlUrl="https://feeds.example/a?b=1&amp;c=2"')
    expect(parseOpml(opml)).toEqual([
      { url: 'https://feeds.example/a?b=1&c=2', title: 'Tom & Jerry\'s "notes" <best>' },
    ])
  })

  it('round trips: its own export parses back to the same Feeds', () => {
    const subscriptions = [
      { title: 'Field Notes', description: 'Notes from the field', resolvedUrl: 'https://feeds.example/journal.xml' },
      { title: 'Atom Letters', description: null, resolvedUrl: 'https://atom.example/feed.xml' },
    ]
    expect(parseOpml(serializeOpml(subscriptions, new Date()))).toEqual([
      { url: 'https://feeds.example/journal.xml', title: 'Field Notes' },
      { url: 'https://atom.example/feed.xml', title: 'Atom Letters' },
    ])
  })
})
