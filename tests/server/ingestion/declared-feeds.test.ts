import { describe, expect, it } from 'vitest'
import { declaredFeeds } from '../../../src/server/ingestion/declared-feeds.js'

const PAGE_URL = 'https://journal.example/notes/index.html'

function page(head: string, body = ''): Uint8Array {
  return new TextEncoder().encode(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`)
}

function find(head: string, body?: string) {
  return declaredFeeds(page(head, body), PAGE_URL)
}

describe('declaredFeeds', () => {
  it('keeps document order, dedupes by resolved URL, and carries the title verbatim or null', () => {
    expect(
      find(
        '<link rel="alternate" type="application/rss+xml" title="Field Notes » Posts" href="/feed">' +
          '<link rel="alternate" type="application/atom+xml" href="/comments/feed">' +
          '<link rel="alternate" type="application/rss+xml" title="the same feed again" href="https://journal.example/feed">',
      ),
    ).toEqual([
      { url: 'https://journal.example/feed', title: 'Field Notes » Posts' },
      { url: 'https://journal.example/comments/feed', title: null },
    ])
  })

  it('matches rel as a token list and the type case-insensitively with its parameters stripped', () => {
    expect(
      find(
        '<link rel="Alternate  nofollow" type="Application/RSS+XML; charset=utf-8" href="/feed">' +
          '<link rel="alternate" type="application/atom+xml" href="/atom">' +
          '<link rel="stylesheet alternate" type="text/css" href="/dark.css">' +
          '<link rel="alternates" type="application/rss+xml" href="/not-alternate">' +
          '<link type="application/rss+xml" href="/no-rel">' +
          '<link rel="alternate" type="application/rss+xml">',
      ).map((feed) => feed.url),
    ).toEqual(['https://journal.example/feed', 'https://journal.example/atom'])
  })

  it('takes only the two spec types: never text/xml, application/xml, or application/feed+json', () => {
    expect(
      find(
        '<link rel="alternate" type="text/xml" href="/text-xml">' +
          '<link rel="alternate" type="application/xml" href="/application-xml">' +
          '<link rel="alternate" type="application/feed+json" href="/feed.json">' +
          '<link rel="alternate" href="/untyped">',
      ),
    ).toEqual([])
  })

  it('resolves a relative href against the first <base href>, itself resolved against the document URL', () => {
    expect(
      find(
        '<base href="../site/"><base href="https://elsewhere.example/">' +
          '<link rel="alternate" type="application/rss+xml" href="feed">',
      ),
    ).toEqual([{ url: 'https://journal.example/site/feed', title: null }])
  })

  it('resolves against the document URL when there is no <base>, and keeps a declaration in the body', () => {
    expect(
      find('<title>a page</title>', '<p>hello</p><link rel="alternate" type="application/rss+xml" href="feed">'),
    ).toEqual([{ url: 'https://journal.example/notes/feed', title: null }])
  })

  it('drops a declaration whose href is not a web address', () => {
    expect(
      find(
        '<link rel="alternate" type="application/rss+xml" href="mailto:editor@journal.example">' +
          '<link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">' +
          '<link rel="alternate" type="application/rss+xml" href="http://[not a url">' +
          '<link rel="alternate" type="application/rss+xml" href="//mirror.example/feed#latest">',
      ),
    ).toEqual([{ url: 'https://mirror.example/feed', title: null }])
  })

  it('parses a document cut mid-tag as it stands', () => {
    const whole = `<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/feed"><title>cut</title></head><body><p>${'x'.repeat(
      200,
    )}</p><link rel="alternate" type="application/rss+xml" href="/after-the-cut"></body></html>`
    const cut = new TextEncoder().encode(whole).subarray(0, whole.indexOf('after-the-cut') + 5)

    expect(declaredFeeds(cut, PAGE_URL)).toEqual([{ url: 'https://journal.example/feed', title: null }])
  })

  it('decodes the title by the transport charset, else the meta charset, else UTF-8', () => {
    const latin1 = new TextEncoder().encode(
      '<link rel="alternate" type="application/rss+xml" href="/feed" title="caf_">',
    )
    latin1[latin1.indexOf('_'.charCodeAt(0))] = 0xe9

    expect(declaredFeeds(latin1, PAGE_URL, 'windows-1252')).toEqual([
      { url: 'https://journal.example/feed', title: 'café' },
    ])
    expect(
      declaredFeeds(
        page('<meta charset="utf-8"><link rel="alternate" type="application/rss+xml" href="/feed" title="café">'),
        PAGE_URL,
      ),
    ).toEqual([{ url: 'https://journal.example/feed', title: 'café' }])
  })
})
