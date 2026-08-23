import { parseHTML } from 'linkedom'
import type { DeclaredFeed } from '../../shared/api.js'
import { decodeHtml } from './html-text.js'

/** The two types the RSS and Atom specs name for a declaration; `text/xml`, `application/xml`, and JSON Feed are not. */
const DECLARED_FEED_TYPES = new Set(['application/rss+xml', 'application/atom+xml'])

/**
 * The Feeds a page declares in `<link rel="alternate">`, in document order and
 * deduped by resolved URL — the first is the page's default. The whole document
 * is scanned, `<body>` included, and a document cut short yields what
 * arrived before the cut. `href` resolves against the first `<base href>` (itself
 * against `documentUrl`), else `documentUrl`, which is the post-redirect
 * address. Only web addresses are kept; `title` is the attribute verbatim, or
 * null when absent or blank.
 */
export function declaredFeeds(bytes: Uint8Array, documentUrl: string, charset?: string): DeclaredFeed[] {
  const { document } = parseHTML(decodeHtml(bytes, charset))
  const base = baseUrl(document.querySelector('base[href]')?.getAttribute('href'), documentUrl)

  const found: DeclaredFeed[] = []
  const seen = new Set<string>()
  for (const link of document.querySelectorAll('link[rel][href]')) {
    const href = link.getAttribute('href')?.trim()
    if (!href || !isDeclaration(link)) continue
    const url = webAddress(href, base)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = link.getAttribute('title')
    found.push({ url, title: title?.trim() ? title : null })
  }
  return found
}

function isDeclaration(link: Element): boolean {
  const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
  const type = (link.getAttribute('type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return rel.includes('alternate') && DECLARED_FEED_TYPES.has(type)
}

function baseUrl(declared: string | null | undefined, documentUrl: string): string {
  if (!declared) return documentUrl
  try {
    return new URL(declared, documentUrl).href
  } catch {
    return documentUrl
  }
}

function webAddress(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}
