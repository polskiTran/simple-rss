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

export function playUnfold(box: HTMLElement, kept: Element | null, heightBefore: number) {
  const timing = { duration: duration('--duration-sheet-enter'), easing: token('--ease-out') }
  if (!reduced()) {
    const to = Math.min(box.offsetHeight, Math.max(heightBefore, heightOnScreen(box)))
    const tone = toneOf(box)
    box.animate([clipped(heightBefore, tone), clipped(to, tone)], { ...timing, easing: token('--ease-drawer') })
  }
  for (const title of following(kept)) title.animate([{ opacity: 0 }, { opacity: 1 }], timing)
}

export async function playFold(box: HTMLElement, kept: Element | null, cut: () => void) {
  if (!kept || reduced()) return cut()
  const scrolledPast = kept.parentElement?.scrollTop ?? 0
  const to =
    kept.getBoundingClientRect().bottom +
    scrolledPast -
    box.getBoundingClientRect().top +
    Number.parseFloat(getComputedStyle(box).paddingBottom)
  const from = Math.min(box.offsetHeight, Math.max(to, heightOnScreen(box)))
  const tone = toneOf(box)
  const closing = box.animate([clipped(from, tone), clipped(to, tone)], {
    duration: duration('--duration-sheet-exit'),
    easing: token('--ease-drawer'),
    fill: 'forwards',
  })
  await closing.finished
  cut()
  closing.cancel()
}

const PAST_EDGE = 32

function heightOnScreen(box: HTMLElement): number {
  return window.innerHeight - box.getBoundingClientRect().top + PAST_EDGE
}

function following(kept: Element | null): Element[] {
  const titles: Element[] = []
  for (let next = kept?.nextElementSibling; next && titles.length < FADED_TITLES; next = next.nextElementSibling) {
    titles.push(next)
  }
  return titles
}

interface Tone {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

function toneOf(box: HTMLElement): Tone {
  const tone = getComputedStyle(box, '::before')
  const inset = (side: string) => Number.parseFloat(side) || 0
  return { top: inset(tone.top), right: inset(tone.right), bottom: inset(tone.bottom), left: inset(tone.left) }
}

function clipped(height: number, tone: Tone): Keyframe {
  return {
    height: `${height}px`,
    clipPath: `inset(${tone.top}px ${tone.right}px ${tone.bottom}px ${tone.left}px)`,
    overflowAnchor: 'none',
    alignContent: 'start',
  }
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
