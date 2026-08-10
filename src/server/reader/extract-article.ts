import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'
import type { SignImageUrl } from '../images/image-url-signature.js'
import { articleMarkdown } from './article-markdown.js'

/**
 * How fast the estimate assumes the User reads. One steady number: the
 * Reader header answers "roughly how long", not "exactly how fast are you".
 */
const WORDS_PER_MINUTE = 225

export interface ExtractedArticle {
  readonly markdown: string
  readonly wordCount: number
  readonly readingTimeMinutes: number
}

export interface ExtractArticleInput {
  /** Decoded bytes of the original page, already bounded by the boundary. */
  readonly bytes: Uint8Array
  /** Character set the transport declared, when it declared one. */
  readonly charset?: string | undefined
  /** The address the bytes actually came from, for resolving links. */
  readonly url: string
  /** Rewrites an approved embedded image to its signed proxy path. */
  readonly signImageUrl?: SignImageUrl
}

/**
 * The temporary Reader rendering of one original page: Defuddle finds the
 * article, the Markdown allowlist keeps only safe structure. Everything here
 * lives and dies with the request — nothing is ever written anywhere.
 *
 * `undefined` means the page yielded no readable article, whatever the
 * mechanical reason; the caller falls back to the stored summary.
 */
export async function extractArticle(input: ExtractArticleInput): Promise<ExtractedArticle | undefined> {
  try {
    // The page is parsed with linkedom rather than jsdom: Defuddle's clutter
    // selectors use CSS jsdom's engine cannot parse, and a selector error
    // there would silently keep the whole page instead of the article. The
    // document is built here, eagerly, because Defuddle's own lazy loading
    // of linkedom does not survive every module loader this code runs under.
    const document = articleDocument(decode(input.bytes, input.charset), input.url)
    const result = await Defuddle(document, input.url)
    const markdown = articleMarkdown(
      result.content ?? '',
      input.url,
      input.signImageUrl ? { signImageUrl: input.signImageUrl } : {},
    )
    if (!markdown) return undefined

    const wordCount = countWords(markdown)
    return {
      markdown,
      wordCount,
      readingTimeMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
    }
  } catch {
    // A document broken enough to crash extraction is simply not readable.
    return undefined
  }
}

/**
 * A linkedom document shaped the way Defuddle expects one: the styleSheets
 * and getComputedStyle it consults exist, and `document.URL` carries the
 * final address so relative links and extractor matching resolve.
 */
function articleDocument(html: string, url: string): Document {
  const { document } = parseHTML(html)
  const doc = document as unknown as {
    styleSheets?: unknown
    defaultView?: { getComputedStyle?: unknown } | null
    URL: string
  }
  doc.styleSheets ??= []
  if (doc.defaultView && !doc.defaultView.getComputedStyle) {
    doc.defaultView.getComputedStyle = () => ({ display: '' })
  }
  doc.URL = url
  return doc as unknown as Document
}

/**
 * Bytes to text, the way a browser would order the evidence: a byte-order
 * mark outranks the transport charset, which outranks a `<meta>` declaration
 * found in the first kilobyte, and UTF-8 is the calm default. An unknown or
 * misdeclared label falls back rather than failing the article.
 */
function decode(bytes: Uint8Array, transportCharset: string | undefined): string {
  const label = bomCharset(bytes) ?? transportCharset ?? metaCharset(bytes) ?? 'utf-8'
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function bomCharset(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  return undefined
}

function metaCharset(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return (
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i.exec(head)?.[1]
  )
}

/** Words as a reader meets them: tokens that carry at least one letter or digit. */
function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
}
