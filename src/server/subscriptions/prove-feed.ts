import { FeedDocumentError, parseFeedDocument, type ParsedFeedDocument } from '../ingestion/feed-document.js'
import type { Retrieval, RetrievalBytes, RetrievalOperation } from '../upstream/retrieval.js'
import type { FailedPoll } from './feed-availability.js'

/** The `ETag` and `Last-Modified` a Feed last answered with; `null` where it sent none. */
export interface FeedValidators {
  readonly etag: string | null
  readonly lastModified: string | null
}

export interface ProvenFeed {
  readonly kind: 'proven'
  /** Where the Feed was actually found and what it answered with, for the Feed Window write. */
  readonly retrieved: RetrievalBytes
  readonly parsed: ParsedFeedDocument
}

/** The publisher answered 304. `validators` are the newest: rotated by the answer, else the ones sent. */
export interface UnchangedFeed {
  readonly kind: 'not-modified'
  readonly validators: FeedValidators
}

export type FeedProof = ProvenFeed | FailedPoll

interface ProveFeedOptions {
  readonly retrieval: Pick<Retrieval, 'retrieveBytes'>
  readonly url: string
  readonly operation: RetrievalOperation
  /** Other URLs this Feed is known by, so a document naming one as its site is still the Feed itself. */
  readonly priorUrls?: readonly string[]
  readonly signal?: AbortSignal
}

/**
 * The one place retrieval and parsing of a Feed document meet: retrieve `url`
 * under `operation`, parse what came back, answer the document or why there is
 * none. Nothing is written; the caller decides what a proof earns.
 *
 * Only a caller that sends validators can be told `not-modified`. A publisher
 * that answers 304 to an unconditional request has answered without a body,
 * which is an `http_error` like any other bodiless status.
 */
export function proveFeed(
  options: ProveFeedOptions & { readonly validators: FeedValidators },
): Promise<FeedProof | UnchangedFeed>
export function proveFeed(options: ProveFeedOptions): Promise<FeedProof>
export async function proveFeed(
  options: ProveFeedOptions & { readonly validators?: FeedValidators },
): Promise<FeedProof | UnchangedFeed> {
  const { retrieval, url, operation, validators, priorUrls = [], signal } = options

  const headers: Record<string, string> = {}
  if (validators?.etag) headers['if-none-match'] = validators.etag
  if (validators?.lastModified) headers['if-modified-since'] = validators.lastModified

  const retrieved = await retrieval.retrieveBytes({ url, operation, headers, ...(signal && { signal }) })
  if (!retrieved.ok) return { kind: 'retrieval-failed', failure: retrieved }

  if (retrieved.notModified) {
    if (!validators) {
      return {
        kind: 'retrieval-failed',
        failure: { ok: false, code: 'http_error', reason: 'answered 304 to an unconditional request', status: 304 },
      }
    }
    return {
      kind: 'not-modified',
      validators: {
        etag: retrieved.etag ?? validators.etag,
        lastModified: retrieved.lastModified ?? validators.lastModified,
      },
    }
  }

  try {
    return { kind: 'proven', retrieved, parsed: parseFeedDocument(retrieved.bytes, retrieved.url, [url, ...priorUrls]) }
  } catch (error) {
    if (error instanceof FeedDocumentError) return { kind: 'invalid-feed', code: error.code }
    throw error
  }
}
