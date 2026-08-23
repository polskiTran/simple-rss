import { eq } from 'drizzle-orm'
import type { DrizzleDatabase } from '../persistence/database.js'
import { feedItems } from '../persistence/schema.js'
import { RetrievalError, type Retrieval, type RetrievalFailure } from '../upstream/retrieval.js'

export type ImageOutcome =
  | { readonly kind: 'missing' }
  | { readonly kind: 'retrieval-failed'; readonly failure: RetrievalFailure }
  | { readonly kind: 'not-image' }
  | { readonly kind: 'image'; readonly contentType: string; readonly body: ReadableStream<Uint8Array> }

export class ImageService {
  readonly #db: DrizzleDatabase
  readonly #retrieval: Retrieval

  constructor(options: { db: DrizzleDatabase; retrieval: Retrieval }) {
    this.#db = options.db
    this.#retrieval = options.retrieval
  }

  async itemImage(feedItemId: number, signal?: AbortSignal): Promise<ImageOutcome> {
    const row = this.#db
      .select({ imageUrl: feedItems.imageUrl })
      .from(feedItems)
      .where(eq(feedItems.id, feedItemId))
      .limit(1)
      .all()[0]
    if (!row?.imageUrl) return { kind: 'missing' }

    return this.#fetch(row.imageUrl, signal)
  }

  /** An embedded Reader image whose URL the caller has already proven signed. */
  async readerImage(url: string, signal?: AbortSignal): Promise<ImageOutcome> {
    return this.#fetch(url, signal)
  }

  async #fetch(url: string, signal?: AbortSignal): Promise<ImageOutcome> {
    const result = await this.#retrieval.retrieve({ url, operation: 'image', ...(signal ? { signal } : {}) })
    if (!result.ok) return { kind: 'retrieval-failed', failure: result }

    if (result.notModified) return { kind: 'not-image' }

    const sniffed = await sniffImage(result.contentType, result.body)
    if (!sniffed.ok) {
      return sniffed.failure ? { kind: 'retrieval-failed', failure: sniffed.failure } : { kind: 'not-image' }
    }

    return { kind: 'image', contentType: result.contentType, body: sniffed.body }
  }
}

const SNIFF_LENGTH = 12

type SniffResult =
  | { readonly ok: true; readonly body: ReadableStream<Uint8Array> }
  | { readonly ok: false; readonly failure?: RetrievalFailure }

async function sniffImage(contentType: string, body: ReadableStream<Uint8Array>): Promise<SniffResult> {
  const matches = IMAGE_SIGNATURES[contentType]
  const reader = body.getReader()

  let head = new Uint8Array(0)
  let ended = false
  try {
    while (head.byteLength < SNIFF_LENGTH) {
      const chunk = await reader.read()
      if (chunk.done) {
        ended = true
        break
      }
      const grown = new Uint8Array(head.byteLength + chunk.value.byteLength)
      grown.set(head)
      grown.set(chunk.value, head.byteLength)
      head = grown
    }
  } catch (error) {
    const code = error instanceof RetrievalError ? error.code : 'unavailable'
    return { ok: false, failure: { ok: false, code, reason: 'the image body failed while sniffing' } }
  }

  if (!matches || head.byteLength < SNIFF_LENGTH || !matches(head)) {
    void reader.cancel().catch(() => {})
    return { ok: false }
  }

  return { ok: true, body: replay(head, reader, ended) }
}

function replay(
  head: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ended: boolean,
): ReadableStream<Uint8Array> {
  let replayed = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!replayed) {
        replayed = true
        controller.enqueue(head)
        return
      }
      if (ended) {
        controller.close()
        return
      }
      try {
        const chunk = await reader.read()
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {})
    },
  })
}

const ascii = (head: Uint8Array, at: number, expected: string): boolean =>
  [...expected].every((char, index) => head[at + index] === char.charCodeAt(0))

const IMAGE_SIGNATURES: Readonly<Record<string, (head: Uint8Array) => boolean>> = {
  'image/jpeg': (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  'image/png': (head) =>
    head[0] === 0x89 &&
    ascii(head, 1, 'PNG') &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a,
  'image/gif': (head) => ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a'),
  'image/webp': (head) => ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP'),
  'image/avif': (head) => ascii(head, 4, 'ftyp') && (ascii(head, 8, 'avif') || ascii(head, 8, 'avis')),
}
