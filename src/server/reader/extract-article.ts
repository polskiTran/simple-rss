import { Defuddle } from 'defuddle/node'
import { parseHTML } from 'linkedom'
import { elapsedMs } from '../monotonic.js'
import type { SignImageUrl } from '../images/image-url-signature.js'
import { applyReaderMarkdownPolicy } from '../markdown/markdown-policy.js'
import { readingTimeMinutes } from '../markdown/reading-time.js'

const UNSUPPORTED_ACTIVE_CONTENT = /<(?:iframe|video|audio|object|embed)\b/i

export const FULL_CLEANUP_MAX_BYTES = 512 * 1024
export const FULL_CLEANUP_MAX_ELEMENTS = 5_000

const IRRELEVANT_DOM_SELECTOR = [
  'script:not([type="application/ld+json"]):not([type^="math/"]):not([src*="mathjax" i]):not([src*="katex" i])',
  'style',
  'template',
  'noscript',
  'iframe',
  'video',
  'audio',
  'object',
  'embed',
].join(', ')

type ArticleDocument = ReturnType<typeof parseHTML>['document']

export interface ExtractedArticle {
  readonly markdown: string
  readonly readingTimeMinutes: number
}

export interface ExtractArticleInput {
  readonly bytes: Uint8Array
  readonly charset?: string | undefined
  readonly url: string
  readonly signImageUrl: SignImageUrl
}

export interface ExtractionTimings {
  readonly domMs?: number | undefined
  readonly defuddleMs?: number | undefined
  readonly markdownPolicyMs?: number | undefined
}

export interface ExtractArticleOutcome {
  readonly article: ExtractedArticle | undefined
  readonly timings: ExtractionTimings
}

export async function extractArticle(input: ExtractArticleInput): Promise<ExtractArticleOutcome> {
  const timings: { -readonly [Phase in keyof ExtractionTimings]: ExtractionTimings[Phase] } = {}
  try {
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
    if (result.wordCount === 0 && UNSUPPORTED_ACTIVE_CONTENT.test(result.content)) {
      return { article: undefined, timings }
    }

    const policyStartedAt = performance.now()
    const markdown = applyReaderMarkdownPolicy(result.contentMarkdown ?? '', {
      baseUrl: input.url,
      images: { sign: input.signImageUrl },
    })
    timings.markdownPolicyMs = elapsedMs(policyStartedAt)
    if (!markdown) return { article: undefined, timings }

    return {
      article: { markdown, readingTimeMinutes: readingTimeMinutes(markdown) },
      timings,
    }
  } catch {
    return { article: undefined, timings }
  }
}

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
