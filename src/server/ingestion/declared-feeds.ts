import { parseHTML } from 'linkedom'

const DECLARED_FEED_TYPES = new Set(['application/rss+xml', 'application/atom+xml'])

/**
 * The Declared Feeds of a web page: its `<link rel="alternate">` elements typed
 * RSS or Atom, resolved against the page's `<base href>` and then `pageUrl`.
 * Only HTTP(S) addresses count; each is listed once, in page order, without its
 * fragment.
 */
export function declaredFeeds(html: string, pageUrl: string): string[] {
  const { document } = parseHTML(html)
  const base = httpUrl(document.querySelector('base[href]')?.getAttribute('href'), pageUrl) ?? pageUrl
  const feeds = new Set<string>()
  for (const link of document.querySelectorAll('link[rel][type][href]')) {
    const relations = link.getAttribute('rel')?.toLowerCase().split(/\s+/) ?? []
    const type = link.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (!relations.includes('alternate') || !DECLARED_FEED_TYPES.has(type)) continue
    const url = httpUrl(link.getAttribute('href'), base)
    if (url) feeds.add(url)
  }
  return [...feeds]
}

function httpUrl(href: string | null | undefined, base: string): string | undefined {
  if (!href?.trim()) return undefined
  try {
    const url = new URL(href.trim(), base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}
