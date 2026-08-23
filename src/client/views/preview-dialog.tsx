import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { DeclaredFeed, FeedPreview, SubscriptionSummary } from '../../shared/api.js'
import { previewFeed, subscribeToFeed } from '../api.js'
import { LoadingNote } from '../components/loading-note.js'
import { subscriptionFailure } from './feed-language.js'

/** One submission of the field. A fresh object reopens the dialog, even for the address just abandoned. */
export interface PreviewRequest {
  readonly url: string
}

type Phase =
  | { readonly kind: 'previewing'; readonly url: string; readonly declaredFeeds: DeclaredFeed[] }
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

export function PreviewDialog({ request, field, onSubscribed, onFailed, onOpenFeed }: PreviewDialogProps) {
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState<{ readonly request: PreviewRequest; readonly phase: Phase }>()
  const inFlight = useRef<AbortController>(undefined)
  const popup = useRef<HTMLDivElement>(null)
  // Base UI keeps the popup mounted through its exit fade: an answer stays keyed to
  // its request so the body holds still then, and the next request opens on the wait.
  const phase = answer && answer.request === request ? answer.phase : undefined

  const load = useCallback(
    (request: PreviewRequest, url: string, declaredByPage?: DeclaredFeed[]) => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      previewFeed(url, controller.signal)
        .then((preview) =>
          setAnswer({
            request,
            phase: {
              kind: 'arrived',
              preview: declaredByPage ? { ...preview, declaredFeeds: declaredByPage } : preview,
            },
          }),
        )
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setOpen(false)
          onFailed(subscriptionFailure(error))
        })
      return controller
    },
    [onFailed],
  )

  useEffect(() => {
    if (!request) return
    setOpen(true)
    const controller = load(request, request.url)
    return () => controller.abort()
  }, [request, load])

  function choose(url: string, declaredFeeds: DeclaredFeed[]) {
    if (!request) return
    setAnswer({ request, phase: { kind: 'previewing', url, declaredFeeds } })
    load(request, url, declaredFeeds)
  }

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
            {phase === undefined || phase.kind === 'previewing' ? (
              <>
                <Dialog.Title className="overlay-title">
                  previewing {hostOf(phase?.url ?? request?.url ?? '')}
                </Dialog.Title>
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
                onChoose={(url) => choose(url, phase.preview.declaredFeeds)}
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
  onChoose,
  onOpenFeed,
}: {
  preview: FeedPreview
  subscribing: boolean
  onSubscribe: () => void
  onChoose: (url: string) => void
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
      {preview.declaredFeeds.length > 1 ? (
        <>
          <p className="preview-caption">this page declares {preview.declaredFeeds.length} feeds</p>
          <ul className="preview-declared">
            {preview.declaredFeeds.map((feed) => (
              <li key={feed.url}>
                <Button
                  className="text-button"
                  disabled={feed.url === preview.url || subscribing}
                  onClick={() => onChoose(feed.url)}
                >
                  {declaredFeedName(feed)}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
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
        <Dialog.Close className="text-button" disabled={subscribing} render={<Button focusableWhenDisabled />}>
          cancel
        </Dialog.Close>
      </p>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function declaredFeedName(feed: DeclaredFeed): string {
  if (feed.title) return feed.title
  try {
    return new URL(feed.url).pathname
  } catch {
    return feed.url
  }
}
