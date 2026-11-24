import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ApiErrorCode, CreateSubscriptionResponse, FeedPreview, FeedPreviewResponse } from '../../shared/api.js'
import { hasOwn } from '../../shared/record.js'
import { ApiError, previewFeed, subscribeToFeed } from '../api.js'
import { addFailure, feedAddressOf, NOT_AN_ADDRESS } from './feed-language.js'

const LOOKUP_PAUSE_MS = 800

interface Answer {
  readonly host: string
  readonly feeds: readonly FeedPreview[]
  readonly chosen: FeedPreview
}

type Lookup =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly host: string }
  | (Answer & { readonly kind: 'found'; readonly refused: string | undefined })
  | (Answer & { readonly kind: 'subscribing' })
  | { readonly kind: 'failed'; readonly reason: string; readonly retry: boolean }

const IDLE: Lookup = { kind: 'idle' }

export function useFeedLookup({
  active,
  onSubscribed,
}: {
  readonly active: boolean
  onSubscribed(created: CreateSubscriptionResponse): void
}) {
  const [address, setAddress] = useState('')
  const [lookup, setLookup] = useState<Lookup>(IDLE)
  const inFlight = useRef<AbortController | undefined>(undefined)

  function settle(next: Lookup) {
    inFlight.current?.abort()
    inFlight.current = undefined
    setLookup(next)
  }

  async function lookUp(line: string) {
    const url = feedAddressOf(line)
    if (!url) {
      settle({ kind: 'failed', reason: NOT_AN_ADDRESS, retry: false })
      return
    }
    const host = new URL(url).host
    settle({ kind: 'reading', host })
    const lookingUp = new AbortController()
    inFlight.current = lookingUp
    try {
      const preview = await previewFeed(url, lookingUp.signal)
      if (!lookingUp.signal.aborted) setLookup(found(preview, host))
    } catch (cause) {
      if (!lookingUp.signal.aborted) setLookup({ kind: 'failed', ...addFailure(cause, host) })
    }
  }

  useEffect(() => () => inFlight.current?.abort(), [])

  const lookUpPaused = useEffectEvent((line: string) => void lookUp(line))
  useEffect(() => {
    if (!active || lookup.kind !== 'idle' || address.trim() === '') return
    const timer = window.setTimeout(() => lookUpPaused(address), LOOKUP_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [active, address, lookup.kind])

  async function subscribe({ host, feeds, chosen }: Answer) {
    settle({ kind: 'subscribing', host, feeds, chosen })
    const subscribing = new AbortController()
    inFlight.current = subscribing
    try {
      const created = await subscribeToFeed(chosen.feedUrl, subscribing.signal)
      onSubscribed(created)
    } catch (cause) {
      if (subscribing.signal.aborted) return
      const { reason } = addFailure(cause, new URL(chosen.feedUrl).host)
      setLookup({ kind: 'found', host, feeds, chosen, refused: reason })
    }
  }

  const answer = lookup.kind === 'found' || lookup.kind === 'subscribing' ? lookup : undefined
  const failure = lookup.kind === 'failed' ? lookup : undefined
  return {
    address,
    lookup,
    answer,
    failure,
    subscribing: lookup.kind === 'subscribing',
    refusal: failure?.reason ?? (lookup.kind === 'found' ? lookup.refused : undefined),
    changeAddress(next: string) {
      const pasted = next.length - address.length > 1
      setAddress(next)
      if (pasted && feedAddressOf(next)) void lookUp(next)
      else settle(IDLE)
    },
    proceed() {
      if (lookup.kind === 'found') {
        if (!lookup.chosen.subscribed) void subscribe(lookup)
      } else if (lookup.kind !== 'reading' && lookup.kind !== 'subscribing') {
        void lookUp(address)
      }
    },
    choose(feed: FeedPreview) {
      if (lookup.kind === 'found') setLookup({ ...lookup, chosen: feed, refused: undefined })
    },
    stop() {
      settle(IDLE)
    },
    reset() {
      settle(IDLE)
      setAddress('')
    },
  }
}

function found(preview: FeedPreviewResponse, host: string): Lookup {
  if (preview.kind === 'feed') {
    return { kind: 'found', host, feeds: [preview.feed], chosen: preview.feed, refused: undefined }
  }
  const [first] = preview.feeds
  if (!first) {
    return { kind: 'failed', reason: `${preview.host} doesn’t name a feed. Try the feed’s own address.`, retry: false }
  }
  return { kind: 'found', host: preview.host, feeds: preview.feeds, chosen: first, refused: undefined }
}

const IMPORT_FAILURE_COPY = {
  malformed_opml: 'That file is malformed XML.',
  unsupported_opml: 'That file isn’t an OPML subscription list.',
  too_many_feeds: 'That file lists more feeds than one import can take.',
  invalid_request: 'That file is too large to import.',
} as const satisfies Partial<Record<ApiErrorCode, string>>

export function importFailure(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'The reader is unavailable.'
  const code = cause.code
  return hasOwn(IMPORT_FAILURE_COPY, code) ? IMPORT_FAILURE_COPY[code] : 'That file couldn’t be imported.'
}
