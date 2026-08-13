import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFeedDocument } from '../../../src/server/ingestion/feed-document.js'

const FIXTURES = join(import.meta.dirname, '../../fixtures/feeds')
const RESOLVED_URL = 'https://feeds.example/feed.xml'

function parseFixture(name: string) {
  return parseFeedDocument(new TextEncoder().encode(readFileSync(join(FIXTURES, name), 'utf-8')), RESOLVED_URL)
}

// RSS and Atom parity: both formats normalize to the same shape under the
// same identity contract.
describe('parseFeedDocument', () => {
  it('normalizes a representative RSS document', () => {
    const parsed = parseFixture('rss-representative.xml')

    expect(parsed.title).toBe('Field Notes')
    expect(parsed.homePageUrl).toBe('https://journal.example/')
    expect(parsed.items).toEqual([
      {
        dedupeKey: 'guid:entry-1',
        identityKind: 'guid',
        title: 'First light',
        link: 'https://journal.example/first-light',
        publishedAt: '2026-08-08T07:15:00.000Z',
        imageUrl: 'https://images.example/first-light.jpg',
        summary: 'A clear morning. The post First light appeared first on Field Notes.',
      },
      {
        dedupeKey: 'link:https://feeds.example/relative-path',
        identityKind: 'link',
        title: 'No stable id',
        link: 'https://feeds.example/relative-path',
        publishedAt: '2026-08-07T12:00:00.000Z',
        imageUrl: null,
        summary: 'Falls back to its link.',
      },
    ])
  })

  it('normalizes a representative Atom document to the identical shape', () => {
    const parsed = parseFixture('atom-representative.xml')

    expect(parsed.title).toBe('Atom Letters')
    // The alternate link wins over the self link sitting beside it.
    expect(parsed.homePageUrl).toBe('https://atom.example/')
    expect(parsed.items).toEqual([
      {
        dedupeKey: 'guid:tag:atom.example,2026:one',
        identityKind: 'guid',
        title: 'One letter',
        // Relative Atom links resolve against the resolved Feed URL.
        link: 'https://feeds.example/letters/one',
        publishedAt: '2026-08-08T07:15:00.000Z',
        imageUrl: 'https://images.example/one.jpg',
        summary: 'Kept as plain text.',
      },
      {
        dedupeKey: 'guid:tag:atom.example,2026:two',
        identityKind: 'guid',
        title: 'Two',
        link: 'https://atom.example/letters/two',
        publishedAt: '2026-08-07T20:00:00.000Z',
        imageUrl: null,
        summary: 'Content stands in for a missing summary.',
      },
    ])
  })

  it('maps an RSS GUID and an Atom ID into the same identity contract', () => {
    const [rssItem] = parseFixture('rss-representative.xml').items
    const [atomItem] = parseFixture('atom-representative.xml').items

    expect(rssItem?.identityKind).toBe('guid')
    expect(atomItem?.identityKind).toBe('guid')
    expect(rssItem?.dedupeKey).toMatch(/^guid:/)
    expect(atomItem?.dedupeKey).toMatch(/^guid:/)
  })

  it('accepts a namespace-prefixed Atom document', () => {
    const parsed = parseFixture('atom-namespaced.xml')

    expect(parsed.title).toBe('Prefixed Letters')
    expect(parsed.homePageUrl).toBe('https://prefixed.example/')
    expect(parsed.items).toEqual([
      {
        dedupeKey: 'guid:tag:prefixed.example,2026:one',
        identityKind: 'guid',
        title: 'Prefixed entry',
        link: 'https://prefixed.example/one',
        publishedAt: '2026-08-08T06:00:00.000Z',
        imageUrl: null,
        summary: 'Namespace prefixes change nothing.',
      },
    ])
  })

  it.each(['rss-missing-optional.xml', 'atom-missing-optional.xml'])(
    'keeps %s usable when every optional field is missing',
    (name) => {
      const parsed = parseFixture(name)

      // No Feed title falls back to the resolved hostname in both formats.
      expect(parsed.title).toBe('feeds.example')
      expect(parsed.items).toHaveLength(1)
      expect(parsed.items[0]).toMatchObject({
        identityKind: 'content',
        title: 'Only a title',
        link: null,
        publishedAt: null,
        imageUrl: null,
        summary: null,
      })
      expect(parsed.items[0]?.dedupeKey).toMatch(/^content:[0-9a-f]{64}$/)
    },
  )

  it.each(['rss-self-link.xml', 'atom-self-link.xml'])(
    'reads no home page from %s, which declares only the Feed URL itself',
    (name) => {
      expect(parseFixture(name).homePageUrl).toBeNull()
    },
  )

  it.each(['rss-missing-optional.xml', 'atom-missing-optional.xml'])(
    'reads no home page from %s, which declares none',
    (name) => {
      expect(parseFixture(name).homePageUrl).toBeNull()
    },
  )

  it('resolves a relative home page against the resolved Feed URL', () => {
    expect(parseFixture('rss-relative-home-page.xml').homePageUrl).toBe('https://feeds.example/about')
  })

  // A Feed that moved keeps naming the URL it was pasted from, so the same page
  // over http, or with a trailing slash, is still the Feed and still no site.
  it.each(['http://feeds.example/feed.xml', 'https://feeds.example/feed.xml/'])(
    'reads no home page from a Feed declaring %s, a redirect variant of its own URL',
    (declared) => {
      const xml = `<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Moved</title><link>${declared}</link></channel></rss>`
      expect(parseFeedDocument(new TextEncoder().encode(xml), RESOLVED_URL).homePageUrl).toBeNull()
    },
  )

  it('reads no home page from a Feed declaring the URL it was reached by before a redirect', () => {
    const entered = 'https://feedproxy.example/feed'
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Proxied</title><link>${entered}</link></channel></rss>`
    expect(parseFeedDocument(new TextEncoder().encode(xml), RESOLVED_URL, [entered]).homePageUrl).toBeNull()
  })

  it('gives entries without any stable ID the same content fingerprint in both formats', () => {
    const [rssItem] = parseFixture('rss-missing-optional.xml').items
    const [atomItem] = parseFixture('atom-missing-optional.xml').items
    expect(rssItem?.dedupeKey).toBe(atomItem?.dedupeKey)
  })

  it('rejects a malformed document as malformed_feed', () => {
    expect(() => parseFixture('malformed.xml')).toThrowError(
      expect.objectContaining({ name: 'FeedDocumentError', code: 'malformed_feed' }),
    )
  })

  it('rejects XML that is not a Feed as unsupported_feed', () => {
    expect(() => parseFixture('not-a-feed.xml')).toThrowError(
      expect.objectContaining({ name: 'FeedDocumentError', code: 'unsupported_feed' }),
    )
  })
})
