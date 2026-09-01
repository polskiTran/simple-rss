/**
 * PROTOTYPE — throwaway, never ships.
 *
 * Verdict so far: the jump-to group question is settled — D "feeds echo"
 * (name + domain + cadence strip) won; it renders pinned below. The open
 * question is now the masthead: where the search line and the tab bar sit.
 * Four layouts, switchable via `?masthead=` (floating bar, or ← → outside
 * inputs):
 *
 *   A  as shipped — wordmark + search share row one, tabs pushed to row two
 *   B  one row — wordmark · search · tabs on a single line
 *   C  tabs up top — the pre-search masthead restored, search line beneath
 *   D  controls row — brand alone, then search + tabs sharing a line
 *
 * Lives on a throwaway branch; winners get rewritten properly.
 */
import { useEffect, useState } from 'react'
import './search-jump-to-prototype.css'
import type { SearchSubscriptionMatch } from '../../shared/api.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'

const VARIANTS = ['A', 'B', 'C', 'D'] as const
type Variant = (typeof VARIANTS)[number]
const VARIANT_NAMES: Record<Variant, string> = {
  A: 'as shipped',
  B: 'one row',
  C: 'tabs up top',
  D: 'controls row',
}

// The app's own pushState drops query params, so capture ?masthead= once at
// module load (before routing can strip it); sessionStorage keeps it sticky.
const fromUrl = new URLSearchParams(window.location.search).get('masthead')?.toUpperCase()
if (fromUrl && (VARIANTS as readonly string[]).includes(fromUrl)) {
  window.sessionStorage.setItem('proto-masthead', fromUrl)
}

function currentVariant(): Variant {
  const stored = window.sessionStorage.getItem('proto-masthead')?.toUpperCase()
  return (VARIANTS as readonly string[]).includes(stored ?? '') ? (stored as Variant) : 'A'
}

function setVariant(variant: Variant) {
  window.sessionStorage.setItem('proto-masthead', variant)
  const url = new URL(window.location.href)
  url.searchParams.set('masthead', variant)
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new Event('prototype-variant'))
}

export function useMastheadVariant(): Variant {
  const [variant, set] = useState<Variant>(currentVariant)
  useEffect(() => {
    const read = () => set(currentVariant())
    window.addEventListener('prototype-variant', read)
    window.addEventListener('popstate', read)
    return () => {
      window.removeEventListener('prototype-variant', read)
      window.removeEventListener('popstate', read)
    }
  }, [])
  return variant
}

export interface JumpToProps {
  subscriptions: readonly SearchSubscriptionMatch[]
  onOpenFeed: (feedId: number) => void
}

/** The settled jump-to rendering: the feeds-list row condensed (cadence stubbed). */
export function PrototypeJumpTo({ subscriptions, onOpenFeed }: JumpToProps) {
  if (subscriptions.length === 0) return null
  return (
    <nav className="proto-rows" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <div className="proto-feedrow" key={subscription.feedId}>
          <a
            className="proto-feedrow-name"
            href={feedPathOf(subscription.feedId)}
            onClick={routedClick(() => onOpenFeed(subscription.feedId))}
          >
            {subscription.title}
          </a>
          <span className="proto-row-domain">{subscription.domain}</span>
          <span className="proto-strip" aria-hidden="true">
            {stubCadence(subscription.feedId).map((level, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed 14-day window, position is the day.
              <span className="proto-strip-day" data-level={level} key={index} />
            ))}
          </span>
        </div>
      ))}
    </nav>
  )
}

/** Deterministic fake 14-day cadence so the strip is judgeable without API changes. */
function stubCadence(feedId: number): number[] {
  return Array.from({ length: 14 }, (_, day) => {
    const noise = (feedId * 31 + day * 17) % 7
    return noise < 3 ? 0 : noise < 5 ? 1 : noise < 6 ? 2 : 3
  })
}

export function PrototypeSwitcher() {
  const variant = useMastheadVariant()
  const step = (direction: 1 | -1) => {
    const index = (VARIANTS.indexOf(variant) + direction + VARIANTS.length) % VARIANTS.length
    const next = VARIANTS[index]
    if (next) setVariant(next)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return
      window.dispatchEvent(new Event(event.key === 'ArrowLeft' ? 'proto-prev' : 'proto-next'))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const prev = () => step(-1)
    const next = () => step(1)
    window.addEventListener('proto-prev', prev)
    window.addEventListener('proto-next', next)
    return () => {
      window.removeEventListener('proto-prev', prev)
      window.removeEventListener('proto-next', next)
    }
  })

  return (
    <div className="proto-switcher">
      <button type="button" onClick={() => step(-1)} aria-label="previous variant">
        ‹
      </button>
      <span>
        {variant} · {VARIANT_NAMES[variant]}
      </span>
      <button type="button" onClick={() => step(1)} aria-label="next variant">
        ›
      </button>
    </div>
  )
}
