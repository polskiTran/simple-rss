import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'
import { elapsedMs } from '../clock.js'
import type { SignImageUrl } from '../images/image-url-signature.js'
import { applyReaderMarkdownPolicy } from './markdown-policy.js'

const WORDS_PER_MINUTE = 225
const UNSUPPORTED_ACTIVE_CONTENT = /<(?:iframe|video|audio|object|embed)\b/i

/**
 * Reader policy bounds for full Defuddle cleanup — not caller-configurable.
 * A document above either bound takes the fast profile: Defuddle content-pattern
 * removal is skipped, so harmless boilerplate may survive, but the article and
 * the Reader Markdown policy are unchanged.
 */
const FULL_CLEANUP_MAX_BYTES = 512 * 1024
const FULL_CLEANUP_MAX_ELEMENTS = 5_000

/**
 * Removed after parsing, before Defuddle spends cleanup time on them. JSON-LD
 * stays because Defuddle reads it for metadata; math scripts stay because
 * standardization turns them into math content.
 */
const IRRELEVANT_DOM_SELECTOR = [
  'script:not([type="application/ld+json"]):not([type^="math/"])',
  'style',
  'template',
  'noscript',
  'iframe',
  'video',
  'audio',
  'object',
  'embed',
].join(', ')

/** linkedom's document, the only thing this module ever parses or prunes. */
type ArticleDocument = ReturnType<typeof parseHTML>['document']

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

/** Millisecond phase durations; a phase the extraction never reached is absent. */
export interface ExtractionTimings {
  readonly domMs?: number | undefined
  readonly defuddleMs?: number | undefined
  readonly markdownPolicyMs?: number | undefined
}

export interface ExtractArticleOutcome {
  /** `undefined` means no readable article; the caller falls back to the stored summary. */
  readonly article: ExtractedArticle | undefined
  readonly timings: ExtractionTimings
}

/**
 * Everything here lives and dies with the request — nothing is ever written
 * anywhere. Timings carry the phases that ran, whatever the outcome.
 */
export async function extractArticle(input: ExtractArticleInput): Promise<ExtractArticleOutcome> {
  const timings: { -readonly [Phase in keyof ExtractionTimings]: ExtractionTimings[Phase] } = {}
  try {
    // linkedom, not jsdom: Defuddle's clutter selectors use CSS jsdom cannot parse,
    // and a selector error would silently keep the whole page. Built eagerly because
    // Defuddle's lazy linkedom loading does not survive every module loader.
    const domStartedAt = performance.now()
    const document = articleDocument(decode(input.bytes, input.charset), input.url)
    for (const element of document.querySelectorAll(IRRELEVANT_DOM_SELECTOR)) element.remove()
    const fastProfile =
      input.bytes.byteLength > FULL_CLEANUP_MAX_BYTES ||
      document.querySelectorAll('*').length > FULL_CLEANUP_MAX_ELEMENTS
    timings.domMs = elapsedMs(domStartedAt)

    const defuddleStartedAt = performance.now()
    const result = await Defuddle(document, input.url, {
      separateMarkdown: true,
      useAsync: false,
      ...(fastProfile ? { removeContentPatterns: false } : {}),
    })
    timings.defuddleMs = elapsedMs(defuddleStartedAt)
    // Page embeds are pruned before Defuddle, but a synchronous site extractor
    // builds its own embed markup and can represent an otherwise empty page as
    // one. It remains unreadable; Markdown must not turn it into an image.
    if (result.wordCount === 0 && UNSUPPORTED_ACTIVE_CONTENT.test(result.content)) {
      return { article: undefined, timings }
    }

    const policyStartedAt = performance.now()
    const markdown = applyReaderMarkdownPolicy(result.contentMarkdown ?? '', {
      baseUrl: input.url,
      ...(input.signImageUrl ? { signImageUrl: input.signImageUrl } : {}),
    })
    timings.markdownPolicyMs = elapsedMs(policyStartedAt)
    if (!markdown) return { article: undefined, timings }

    const wordCount = countWords(markdown)
    return {
      article: {
        markdown,
        wordCount,
        readingTimeMinutes: Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)),
      },
      timings,
    }
  } catch {
    return { article: undefined, timings }
  }
}

/**
 * Shims the styleSheets and getComputedStyle Defuddle consults; `document.URL`
 * carries the final address so relative links and extractor matching resolve.
 */
function articleDocument(html: string, url: string): ArticleDocument {
  const { document } = parseHTML(html)
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    value: document.styleSheets ?? [],
  })
  if (document.defaultView && !document.defaultView.getComputedStyle) {
    Object.defineProperty(document.defaultView, 'getComputedStyle', {
      configurable: true,
      value: () => ({ display: '' }),
    })
  }
  Object.defineProperty(document, 'URL', { configurable: true, value: url })
  return document
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
