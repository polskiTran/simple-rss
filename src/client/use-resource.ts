import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { failureKind } from './api.js'

/**
 * What a view has of one server read. Loading the same key again carries the value
 * it replaces. A new key carries it too, unless the caller drops it.
 * The two failures carry the error so a view can still tell its own cases apart,
 * a missing Feed or a rate-limited extraction, without re-implementing the request.
 */
export type Resource<T> =
  | { readonly kind: 'loading'; readonly previous: T | undefined }
  | { readonly kind: 'loaded'; readonly value: T }
  | { readonly kind: 'unavailable'; readonly error: unknown }
  | { readonly kind: 'unreachable'; readonly error: unknown }

interface ResourceControls<T> {
  retry(): void
  set(update: (current: T) => T): void
}

interface ResourceOptions {
  readonly dropOnNewKey?: boolean
}

export type OlderState = 'idle' | 'loading' | 'failed'

interface PagedControls<T> extends ResourceControls<T> {
  loadMore(cursor: string): void
  readonly older: OlderState
}

/**
 * One server read, loaded again whenever `key` changes or on `retry()`. `key` is
 * the whole of what makes the read stale: `load` may close over anything, but
 * only a new key asks again. Leaving the view, or a new key, cancels the read.
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options?: ResourceOptions,
): readonly [Resource<T>, ResourceControls<T>] {
  const { held, retry, patch } = useHeld(key, load, options?.dropOnNewKey ?? false)
  return [held.resource, { retry, set: (update) => patch(undefined, update) }]
}

/**
 * A read that goes on in pages: `load(undefined)` is the first, `load(cursor)`
 * each one after, and `append` joins a page onto what is shown. A page that
 * answers after the key changed, or after a retry, is dropped — it belongs to
 * a list no longer in view.
 */
export function usePagedResource<T>(
  key: string,
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<T>,
  append: (shown: T, page: T) => T,
  options?: ResourceOptions,
): readonly [Resource<T>, PagedControls<T>] {
  const { held, retry, patch } = useHeld(key, (signal) => load(undefined, signal), options?.dropOnNewKey ?? false)
  const [older, setOlder] = useState<{ readonly load: number; readonly state: OlderState }>({
    load: 0,
    state: 'idle',
  })
  const more = useRef<AbortController>(undefined)
  useEffect(() => () => more.current?.abort(), [])

  const loadMore = (cursor: string) => {
    const from = held.load
    more.current?.abort()
    const request = new AbortController()
    more.current = request
    setOlder({ load: from, state: 'loading' })
    void load(cursor, request.signal)
      .then((page) => {
        if (request.signal.aborted) return
        patch(from, (shown) => append(shown, page))
        setOlder({ load: from, state: 'idle' })
      })
      .catch(() => {
        if (!request.signal.aborted) setOlder({ load: from, state: 'failed' })
      })
  }

  return [
    held.resource,
    {
      retry,
      set: (update) => patch(undefined, update),
      loadMore,
      older: older.load === held.load ? older.state : 'idle',
    },
  ]
}

export function valueInView<T>(resource: Resource<T>): T | undefined {
  if (resource.kind === 'loaded') return resource.value
  if (resource.kind === 'loading') return resource.previous
  return undefined
}

interface Held<T> {
  readonly key: string
  readonly resource: Resource<T>
  readonly load: number
}

function useHeld<T>(key: string, load: (signal: AbortSignal) => Promise<T>, dropOnNewKey: boolean) {
  const [held, setHeld] = useState<Held<T>>({
    key,
    resource: { kind: 'loading', previous: undefined },
    load: 0,
  })
  const [attempt, setAttempt] = useState(0)
  const loads = useRef(0)
  const run = useEffectEvent(load)

  useEffect(() => {
    const request = new AbortController()
    loads.current += 1
    const id = loads.current
    setHeld((current) => ({
      key,
      load: current.load,
      resource: {
        kind: 'loading',
        previous: dropOnNewKey && current.key !== key ? undefined : valueInView(current.resource),
      },
    }))
    void run(request.signal)
      .then((value) => {
        if (!request.signal.aborted) setHeld({ key, resource: { kind: 'loaded', value }, load: id })
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setHeld({ key, resource: { kind: failureKind(cause), error: cause }, load: id })
      })
    return () => request.abort()
  }, [key, attempt, dropOnNewKey])

  const resource: Resource<T> =
    dropOnNewKey && held.key !== key ? { kind: 'loading', previous: undefined } : held.resource

  const patch = (from: number | undefined, update: (current: T) => T) =>
    setHeld((current) => {
      if (from !== undefined && current.load !== from) return current
      const { resource } = current
      if (resource.kind === 'loaded') return { ...current, resource: { kind: 'loaded', value: update(resource.value) } }
      if (resource.kind === 'loading' && resource.previous !== undefined) {
        return { ...current, resource: { kind: 'loading', previous: update(resource.previous) } }
      }
      return current
    })

  return { held: { resource, load: held.load }, retry: () => setAttempt((current) => current + 1), patch }
}
