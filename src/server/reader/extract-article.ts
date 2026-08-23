import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'
import { decodeHtml } from '../ingestion/html-text.js'
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
    const document = articleDocument(decodeHtml(input.bytes, input.charset), input.url)
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

function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
}
