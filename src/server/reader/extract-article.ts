import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'
import type { SignImageUrl } from '../images/image-url-signature.js'
import { articleMarkdown } from './article-markdown.js'

const WORDS_PER_MINUTE = 225

export interface ExtractedArticle {
  readonly markdown: string
  readonly wordCount: number
  readonly readingTimeMinutes: number
}

export interface ExtractArticleInput {
  readonly bytes: Uint8Array
  readonly charset?: string | undefined
  /** The address the bytes actually came from, for resolving links. */
  readonly url: string
  readonly signImageUrl?: SignImageUrl
}

/**
 * Everything here lives and dies with the request — nothing is ever written anywhere.
 * `undefined` means no readable article; the caller falls back to the stored summary.
 */
export async function extractArticle(input: ExtractArticleInput): Promise<ExtractedArticle | undefined> {
  try {
    // linkedom, not jsdom: Defuddle's clutter selectors use CSS jsdom cannot parse,
    // and a selector error would silently keep the whole page. Built eagerly because
    // Defuddle's lazy linkedom loading does not survive every module loader.
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
    return undefined
  }
}

/**
 * Shims the styleSheets and getComputedStyle Defuddle consults; `document.URL`
 * carries the final address so relative links and extractor matching resolve.
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
 * A BOM outranks the transport charset, which outranks a `<meta>` in the first
 * kilobyte; UTF-8 is the default. An unknown label falls back rather than failing.
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

function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
}
