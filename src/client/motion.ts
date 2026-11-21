const STAGGER_MS = 60
const STAGGER_LIMIT = 8
const FADED_TITLES = 24

function token(name: `--${string}`): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function duration(name: `--duration-${string}`): number {
  const value = token(name)
  return Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)
}

function reduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

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

const PAST_EDGE = 32

function heightOnScreen(list: HTMLElement): number {
  return window.innerHeight - list.getBoundingClientRect().top + PAST_EDGE
}

function clipped(height: number): Keyframe {
  return { height: `${height}px`, overflow: 'clip', alignContent: 'start' }
}

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
