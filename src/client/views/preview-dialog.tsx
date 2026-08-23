import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { FeedPreview, SubscriptionSummary } from '../../shared/api.js'
import { previewFeed, subscribeToFeed } from '../api.js'
import { LoadingNote } from '../components/loading-note.js'
import { subscriptionFailure } from './feed-language.js'

/** One submission of the field. A fresh object reopens the dialog, even for the address just abandoned. */
export interface PreviewRequest {
  readonly url: string
}

type Phase =
  | { readonly kind: 'arrived'; readonly preview: FeedPreview }
  | { readonly kind: 'subscribing'; readonly preview: FeedPreview }

export interface PreviewDialogProps {
  readonly request: PreviewRequest | undefined
  /** Where focus lands when the dialog closes, whatever closed it. */
  readonly field: RefObject<HTMLInputElement | null>
  onSubscribed(subscription: SubscriptionSummary, observedItems: number): void
  /** One sentence for under the field — the preview or the subscribe did not go through. */
  onFailed(sentence: string): void
  onOpenFeed(feedId: number): void
}

/**
 * The question asked before anything is written: `subscribe to <title>?`,
 * with the Feed's host, description, and recent items. Opens at once in its
 * in-progress state; a failed preview closes it with the sentence handed up.
 * What it shows is keyed to the request it answered, so the body holds still
 * through the exit fade and the next request opens on the wait, not on the
 * last answer.
 */
export function PreviewDialog({ request, field, onSubscribed, onFailed, onOpenFeed }: PreviewDialogProps) {
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState<{ readonly request: PreviewRequest; readonly phase: Phase }>()
  const inFlight = useRef<AbortController>(undefined)
  const popup = useRef<HTMLDivElement>(null)
  const phase = answer && answer.request === request ? answer.phase : undefined

  useEffect(() => {
    if (!request) return
    const controller = new AbortController()
    inFlight.current = controller
    setOpen(true)
    previewFeed(request.url, controller.signal)
      .then((preview) => setAnswer({ request, phase: { kind: 'arrived', preview } }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setOpen(false)
        onFailed(subscriptionFailure(error))
      })
    return () => controller.abort()
  }, [request, onFailed])

  function close() {
    inFlight.current?.abort()
    setOpen(false)
  }

  async function subscribe(preview: FeedPreview) {
    if (!request) return
    setAnswer({ request, phase: { kind: 'subscribing', preview } })
    try {
      const { subscription, observedItems } = await subscribeToFeed(preview.url)
      setOpen(false)
      onSubscribed(subscription, observedItems)
    } catch (error) {
      setOpen(false)
      onFailed(subscriptionFailure(error))
    }
  }

  const subscribing = phase?.kind === 'subscribing'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !subscribing) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay-backdrop" />
        <Dialog.Viewport className="overlay-viewport">
          <Dialog.Popup className="overlay-popup" ref={popup} initialFocus={popup} finalFocus={field}>
            {phase === undefined ? (
              <>
                <Dialog.Title className="overlay-title">previewing {hostOf(request?.url ?? '')}</Dialog.Title>
                <LoadingNote className="overlay-description" announce>
                  reading the feed — this can take a few seconds
                </LoadingNote>
                <p className="overlay-choice">
                  <Dialog.Close className="text-button" render={<Button />}>
                    stop
                  </Dialog.Close>
                </p>
              </>
            ) : (
              <Arrived
                preview={phase.preview}
                subscribing={subscribing}
                onSubscribe={() => void subscribe(phase.preview)}
                onOpenFeed={(feedId) => {
                  setOpen(false)
                  onOpenFeed(feedId)
                }}
              />
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Arrived({
  preview,
  subscribing,
  onSubscribe,
  onOpenFeed,
}: {
  preview: FeedPreview
  subscribing: boolean
  onSubscribe: () => void
  onOpenFeed: (feedId: number) => void
}) {
  const { subscribed } = preview
  return (
    <div className="preview-arrived">
      <Dialog.Title className="overlay-title">
        {subscribed ? `already subscribed to ${preview.title}` : `subscribe to ${preview.title}?`}
      </Dialog.Title>
      <Dialog.Description className="overlay-description">
        {preview.description ? `${preview.domain} — ${preview.description}` : preview.domain}
      </Dialog.Description>
      {preview.items.length > 0 ? (
        <>
          <p className="preview-caption">recent items</p>
          <ol className="preview-items">
            {preview.items.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the rows are read-only and the list is replaced whole with each preview.
              <li key={index}>
                <span className="preview-item-title">{item.title}</span>
                <span className="preview-item-date">{item.displayDate}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <p className="overlay-choice">
        {subscribed ? (
          <Button className="text-button" onClick={() => onOpenFeed(subscribed.feedId)}>
            open feed
          </Button>
        ) : (
          <Button className="text-button" focusableWhenDisabled disabled={subscribing} onClick={onSubscribe}>
            {subscribing ? 'subscribing…' : 'subscribe'}
          </Button>
        )}
        {/* Composed onto Button, as every overlay's dismissing word is, so it keeps focus while disabled. */}
        <Dialog.Close className="text-button" disabled={subscribing} render={<Button focusableWhenDisabled />}>
          cancel
        </Dialog.Close>
      </p>
    </div>
  )
}

/** The same host the Feeds list would show; the typed line stands in for one that will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
