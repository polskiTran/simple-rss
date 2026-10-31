import { useEffect, type RefObject } from 'react'
import type { Arrival } from './routing.js'

export function useScreenTitle(name: string | undefined) {
  useEffect(() => {
    document.title = name ? `${name} — simple` : 'simple'
  }, [name])
}

const READER_TAKES_OVER = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const

function focusHeadingWithoutScroll(root: HTMLElement): boolean {
  const heading = root.querySelector('h1')
  if (heading === null) return false
  heading.tabIndex = -1
  heading.focus({ preventScroll: true })
  return true
}

function scrollToRecordedPlace(target: number): boolean {
  window.scrollTo({ top: target })
  return Math.abs(window.scrollY - target) < 1
}

export function useArrival(arrival: Arrival | undefined, page: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = page.current
    if (!arrival || !root) return
    const target = arrival.scrollY
    let focused = document.activeElement instanceof HTMLInputElement
    let placed = target === undefined

    const observer = new MutationObserver(() => settle())
    const takeover = new AbortController()
    const stop = () => {
      observer.disconnect()
      takeover.abort()
    }
    const settle = () => {
      if (!focused) focused = focusHeadingWithoutScroll(root)
      if (target !== undefined && !placed) placed = scrollToRecordedPlace(target)
      if (focused && placed) stop()
    }

    observer.observe(root, { childList: true, subtree: true })
    for (const type of READER_TAKES_OVER) {
      window.addEventListener(type, stop, { signal: takeover.signal, passive: true })
    }
    settle()
    return stop
  }, [arrival, page])
}
