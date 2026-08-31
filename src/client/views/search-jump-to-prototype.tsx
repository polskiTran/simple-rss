/**
 * PROTOTYPE — throwaway, never ships. Four renderings of the Search jump-to
 * group, switchable via `?variant=` (floating bar, or ← → outside inputs):
 *
 *   A  as shipped — full item shape, indistinguishable from results
 *   B  one quiet line — names only, a single wayfinding line
 *   C  compact rows — name + domain, a register below item titles
 *   D  feeds echo — name + domain + cadence strip (stubbed counts)
 *
 * Lives on a throwaway branch; the winner gets rewritten properly.
 */
import { useEffect, useState } from 'react'
import './search-jump-to-prototype.css'
import type { SearchSubscriptionMatch } from '../../shared/api.js'
import { HomePageLink } from '../components/home-page-link.js'
import { routedClick } from '../routed-link.js'
import { feedPathOf } from '../routing.js'

const VARIANTS = ['A', 'B', 'C', 'D'] as const
type Variant = (typeof VARIANTS)[number]
const VARIANT_NAMES: Record<Variant, string> = {
  A: 'as shipped',
  B: 'one quiet line',
  C: 'compact rows',
  D: 'feeds echo',
}

// The app's own pushState drops query params, so capture ?variant= once at
// module load (before routing can strip it); sessionStorage keeps it sticky.
const fromUrl = new URLSearchParams(window.location.search).get('variant')?.toUpperCase()
if (fromUrl && (VARIANTS as readonly string[]).includes(fromUrl)) {
  window.sessionStorage.setItem('proto-variant', fromUrl)
}

function currentVariant(): Variant {
  const stored = window.sessionStorage.getItem('proto-variant')?.toUpperCase()
  return (VARIANTS as readonly string[]).includes(stored ?? '') ? (stored as Variant) : 'A'
}

function setVariant(variant: Variant) {
  window.sessionStorage.setItem('proto-variant', variant)
  const url = new URL(window.location.href)
  url.searchParams.set('variant', variant)
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new Event('prototype-variant'))
}

function useVariant(): Variant {
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

export function PrototypeJumpTo({ subscriptions, onOpenFeed }: JumpToProps) {
  const variant = useVariant()
  if (subscriptions.length === 0) return null
  const Group = { A: VariantA, B: VariantB, C: VariantC, D: VariantD }[variant]
  return <Group subscriptions={subscriptions} onOpenFeed={onOpenFeed} />
}

const openLink = (subscription: SearchSubscriptionMatch, onOpenFeed: (feedId: number) => void, className: string) => (
  <a
    className={className}
    href={feedPathOf(subscription.feedId)}
    onClick={routedClick(() => onOpenFeed(subscription.feedId))}
  >
    {subscription.title}
  </a>
)

/** A — what shipped: standard item shape, 21px title + domain meta row. */
function VariantA({ subscriptions, onOpenFeed }: JumpToProps) {
  return (
    <nav className="content-list" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <article className="content-item" key={subscription.feedId}>
          <h3 className="content-item-title">{openLink(subscription, onOpenFeed, 'feed-open')}</h3>
          <div className="content-meta">
            <HomePageLink domain={subscription.domain} homePageUrl={subscription.homePageUrl} />
          </div>
        </article>
      ))}
    </nav>
  )
}

/** B — a single line of Feed names; the group is wayfinding, not content. */
function VariantB({ subscriptions, onOpenFeed }: JumpToProps) {
  return (
    <nav className="proto-inline" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <span key={subscription.feedId}>{openLink(subscription, onOpenFeed, 'proto-inline-name')}</span>
      ))}
    </nav>
  )
}

/** C — one compact row per Feed: name in ink, domain in meta grey beside it. */
function VariantC({ subscriptions, onOpenFeed }: JumpToProps) {
  return (
    <nav className="proto-rows" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <div className="proto-row" key={subscription.feedId}>
          {openLink(subscription, onOpenFeed, 'proto-row-name')}
          <span className="proto-row-domain">{subscription.domain}</span>
        </div>
      ))}
    </nav>
  )
}

/** D — the feeds-list row condensed: name, domain, and a cadence strip (stubbed). */
function VariantD({ subscriptions, onOpenFeed }: JumpToProps) {
  return (
    <nav className="proto-rows" aria-label="matching subscriptions">
      {subscriptions.map((subscription) => (
        <div className="proto-feedrow" key={subscription.feedId}>
          {openLink(subscription, onOpenFeed, 'proto-feedrow-name')}
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

/** Deterministic fake 14-day cadence so D is judgeable without API changes. */
function stubCadence(feedId: number): number[] {
  return Array.from({ length: 14 }, (_, day) => {
    const noise = (feedId * 31 + day * 17) % 7
    return noise < 3 ? 0 : noise < 5 ? 1 : noise < 6 ? 2 : 3
  })
}

export function PrototypeSwitcher() {
  const variant = useVariant()
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
    <>
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
    </>
  )
}
