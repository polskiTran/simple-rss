import { useEffect, useEffectEvent, useState } from 'react'
import { failureKind } from './views/failure.js'

/**
 * What a view has of one server read. Loading after a load carries the value it is
 * replacing, so a view may keep showing it. The two failures carry the error so a view
 * can still tell its own cases apart — a missing Feed, a rate-limited extraction —
 * without re-implementing the request.
 */
export type Resource<T> =
  | { readonly kind: 'loading'; readonly previous: T | undefined }
  | { readonly kind: 'loaded'; readonly value: T }
  | { readonly kind: 'unavailable'; readonly error: unknown }
  | { readonly kind: 'unreachable'; readonly error: unknown }

export interface ResourceControls<T> {
  /** Loads again from the start; the way back from a failed first load. */
  retry(): void
  /** Patches the value in view — loaded, or still showing while the next load answers. */
  set(update: (current: T) => T): void
}

/** `deps` states what makes the request stale; a change to it, or `retry()`, loads again. */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): readonly [Resource<T>, ResourceControls<T>] {
  const [state, setState] = useState<Resource<T>>({ kind: 'loading', previous: undefined })
  const [attempt, setAttempt] = useState(0)
  const run = useEffectEvent(load)

  useEffect(() => {
    const request = new AbortController()
    setState((current) => ({ kind: 'loading', previous: valueInView(current) }))
    void run(request.signal)
      .then((value) => {
        if (!request.signal.aborted) setState({ kind: 'loaded', value })
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setState({ kind: failureKind(cause), error: cause })
      })
    return () => request.abort()
  }, [attempt, ...deps])

  return [
    state,
    {
      retry: () => setAttempt((current) => current + 1),
      set: (update) =>
        setState((current) => {
          if (current.kind === 'loaded') return { kind: 'loaded', value: update(current.value) }
          if (current.kind === 'loading' && current.previous !== undefined) {
            return { kind: 'loading', previous: update(current.previous) }
          }
          return current
        }),
    },
  ]
}

/** The value a view can show right now: the loaded one, or the one a reload is replacing. */
export function valueInView<T>(resource: Resource<T>): T | undefined {
  if (resource.kind === 'loaded') return resource.value
  if (resource.kind === 'loading') return resource.previous
  return undefined
}
