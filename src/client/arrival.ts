import { useEffect, type RefObject } from 'react'
import type { Arrival } from './routing.js'

/** Names the screen in the tab and the window list: `Digest — simple`, or `simple` until its name loads. */
export function useScreenTitle(name: string | undefined) {
  useEffect(() => {
    document.title = name ? `${name} — simple` : 'simple'
  }, [name])
}

const READER_TAKES_OVER = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const

/**
 * Settles the page on each Arrival: its h1 takes focus without scrolling, so
 * the screen is announced, and the page scrolls to where the Arrival stands.
 * A screen draws its heading and its list as they load, so both wait on the
 * page's changes until they can happen; the User's first key, press or
 * scroll ends the wait. Focus stays in a field the User is typing in.
 */
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
      const heading = focused ? null : root.querySelector('h1')
      if (heading) {
        heading.tabIndex = -1
        heading.focus({ preventScroll: true })
        focused = true
      }
      if (target !== undefined && !placed) {
        window.scrollTo(0, target)
        placed = Math.abs(window.scrollY - target) < 1
      }
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
