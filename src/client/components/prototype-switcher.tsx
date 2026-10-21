// PROTOTYPE — throwaway. Lives on the prototype branch only; never merge to main.
import { type ReactNode, useEffect, useState } from 'react'

const PARAM = 'variant'
const STORE = 'simple-rss.prototype-variant'

/**
 * The prototype variant in force: `?variant=` wins, else the last one picked
 * this tab (so moving around the app keeps it), else the first.
 */
export function usePrototypeVariant<Key extends string>(keys: readonly [Key, ...Key[]]): Key {
  const read = (): Key => {
    const wanted = new URLSearchParams(window.location.search).get(PARAM) ?? safeStored()
    return keys.find((key) => key === wanted) ?? keys[0]
  }
  const [variant, setVariant] = useState(read)
  useEffect(() => {
    const sync = () => setVariant(read())
    window.addEventListener('prototype-variant', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('prototype-variant', sync)
      window.removeEventListener('popstate', sync)
    }
  })
  return variant
}

function safeStored(): string | null {
  try {
    return sessionStorage.getItem(STORE)
  } catch {
    return null
  }
}

function pick(key: string) {
  const url = new URL(window.location.href)
  url.searchParams.set(PARAM, key)
  window.history.replaceState(window.history.state, '', url)
  try {
    sessionStorage.setItem(STORE, key)
  } catch {}
  window.dispatchEvent(new Event('prototype-variant'))
}

/** Floating bottom bar: ← label → and the arrow keys cycle variants. Dev builds only. */
export function PrototypeSwitcher({
  variants,
  current,
  extra,
}: {
  variants: readonly { readonly key: string; readonly name: string }[]
  current: string
  /** More prototype knobs, drawn after the arrows. */
  extra?: ReactNode
}) {
  const index = Math.max(
    0,
    variants.findIndex(({ key }) => key === current),
  )
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length]
    if (next) pick(next.key)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') ?? false)
      )
        return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null
  const shown = variants[index]
  return (
    <div className="prototype-switcher" role="toolbar" aria-label="Prototype variants">
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ←
      </button>
      <span>
        <strong>{shown?.key}</strong> {shown?.name}
        <span className="prototype-switcher-of">
          {' '}
          {index + 1}/{variants.length}
        </span>
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        →
      </button>
      {extra}
    </div>
  )
}
