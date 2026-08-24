import { useEffect, useEffectEvent, useState } from 'react'
import { failureKind } from './views/failure.js'

/**
 * What a view has of one server read. The two failures carry the error so a view can
 * still tell its own cases apart — a missing Feed, a rate-limited extraction — without
 * re-implementing the request.
 */
export type Resource<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly value: T }
  | { readonly kind: 'unavailable'; readonly error: unknown }
  | { readonly kind: 'unreachable'; readonly error: unknown }

export interface ResourceControls<T> {
  /** Loads again from the start; the way back from a failed first load. */
  retry(): void
  /** Patches a loaded value in place — a save flipped, an older page appended. */
  set(update: (current: T) => T): void
}

/** `deps` states what makes the request stale; a change to it, or `retry()`, loads again. */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): readonly [Resource<T>, ResourceControls<T>] {
  const [state, setState] = useState<Resource<T>>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const run = useEffectEvent(load)

  useEffect(() => {
    const request = new AbortController()
    setState({ kind: 'loading' })
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
        setState((current) => (current.kind === 'loaded' ? { kind: 'loaded', value: update(current.value) } : current)),
    },
  ]
}
