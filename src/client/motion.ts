/**
 * The Digest's motion. Everything but a fold plays on elements React has
 * already changed, so a skipped animation leaves exactly what the screen would
 * show without it; a fold plays first and then makes its change. Curves and
 * durations come from the theme's tokens in `styles.css`.
 */

const STAGGER_MS = 60
/** Past this many days, the rest arrive together rather than queue behind them. */
const STAGGER_LIMIT = 8
/** Titles past these are below the screen when a Feed's day unfolds, so they appear at once. */
const FADED_TITLES = 24

function token(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function duration(name: `--duration-${string}`): number {
  return Number.parseFloat(token(name))
}

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A Feed's day unfolding. Call after the titles are in, with the list's height
 * from before: the list opens from it to its new height, so what sits below
 * slides rather than jumps, and the titles that just appeared fade in place.
 * A list that runs past the screen opens only as far as the screen's bottom
 * edge, so the whole of the easing is seen; the rest of it arrives off screen. With reduced motion, the height changes at once and the titles fade.
 */
export function playUnfold(list: HTMLElement, heightBefore: number, shownBefore: number) {
  const timing = { duration: duration('--duration-sheet-enter'), easing: token('--ease-out') }
  if (!reduced()) {
    const to = Math.min(list.offsetHeight, Math.max(heightBefore, heightOnScreen(list)))
    list.animate([clipped(heightBefore), clipped(to)], timing)
  }
  for (const title of [...list.children].slice(shownBefore, shownBefore + FADED_TITLES)) {
    title.animate([{ opacity: 0 }, { opacity: 1 }], timing)
  }
}

/**
 * A Feed's day folding to its first `keep` titles. Call before the titles are
 * cut: the list closes over the titles still in it, so the ones that stay
 * never move, and `cut` then removes the rest in the frame the closing ends.
 * A list that runs past the screen closes from the screen's bottom edge. With
 * reduced motion it cuts at once.
 */
export async function playFold(list: HTMLElement, keep: number, cut: () => void) {
  const last = list.children[keep - 1]
  if (!last || reduced()) return cut()
  const top = list.getBoundingClientRect().top
  const to = last.getBoundingClientRect().bottom - top + Number.parseFloat(getComputedStyle(list).paddingBottom)
  const from = Math.min(list.offsetHeight, Math.max(to, heightOnScreen(list)))
  const closing = list.animate([clipped(from), clipped(to)], {
    duration: duration('--duration-sheet-exit'),
    easing: token('--ease-out'),
    fill: 'forwards',
  })
  await closing.finished
  cut()
  closing.cancel()
}

/** Just past the screen's bottom edge, so a box's own bottom border never stops in view. */
const PAST_EDGE = 32

/** How much of a list can be seen at most: from its top to the screen's bottom edge. */
function heightOnScreen(list: HTMLElement): number {
  return window.innerHeight - list.getBoundingClientRect().top + PAST_EDGE
}

/** A list held at a height, its rows kept at the top rather than spread to fill it. */
function clipped(height: number): Keyframe {
  return { height: `${height}px`, overflow: 'clip', alignContent: 'start' }
}

/**
 * The Digest starting from another day. The new list rises from below when the
 * User went back in time and drops from above when they came forward, matching
 * a list that runs newest first. With reduced motion it only fades.
 */
export function playDayChange(list: HTMLElement, direction: 'older' | 'newer') {
  const offset = direction === 'older' ? '12px' : '-12px'
  list.animate(
    reduced()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translateY(${offset})` },
          { opacity: 1, transform: 'none' },
        ],
    { duration: duration('--duration-sheet-enter'), easing: token('--ease-out') },
  )
}

/** Days Show more just added, fading in one after another. Opacity only, so nothing moves. */
export function playArrivals(days: readonly Element[]) {
  days.forEach((day, index) => {
    day.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: duration('--duration-sheet-enter'),
      delay: Math.min(index, STAGGER_LIMIT) * STAGGER_MS,
      easing: token('--ease-out'),
      fill: 'backwards',
    })
  })
}
