import { useEffect, type ReactNode } from 'react'

/* PROTOTYPE — throwaway. The floating bar that flips a page between `?variant=`
   keys. Dev builds only; never part of the design being judged. */

export interface PrototypeVariant {
  readonly key: string
  readonly name: string
}

export interface PrototypeSwitcherProps {
  readonly variants: readonly PrototypeVariant[]
  readonly current: string
  onChange(key: string): void
  /** Scenario shortcuts, rendered under the arrows. */
  readonly children?: ReactNode
}

export function PrototypeSwitcher({ variants, current, onChange, children }: PrototypeSwitcherProps) {
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  )
  const step = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]
    if (next) onChange(next.key)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable]')) return
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null

  const active = variants[index]
  return (
    <div className="prototype-bar" role="group" aria-label="prototype variants">
      <div className="prototype-bar-row">
        <button type="button" className="prototype-bar-arrow" onClick={() => step(-1)} aria-label="previous variant">
          ←
        </button>
        <span className="prototype-bar-label">
          {active?.key} — {active?.name}
        </span>
        <button type="button" className="prototype-bar-arrow" onClick={() => step(1)} aria-label="next variant">
          →
        </button>
      </div>
      {children ? <div className="prototype-bar-row prototype-bar-scenarios">{children}</div> : null}
    </div>
  )
}

/** The `?variant=` key in the address, if any — absent means the page runs as shipped. */
export function variantInAddress(): string | undefined {
  return new URLSearchParams(window.location.search).get('variant') ?? undefined
}

export function writeVariantToAddress(key: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('variant', key)
  window.history.replaceState(window.history.state, '', url)
}
