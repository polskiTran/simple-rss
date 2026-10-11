// PROTOTYPE — throwaway switcher for `?variant=` prototypes. Never ships: callers mount it in development only.

import { useEffect, type ReactNode } from 'react'

interface PrototypeSwitcherProps {
  readonly variants: readonly { readonly key: string; readonly name: string }[]
  readonly current: string
  readonly children?: ReactNode
  onChange(key: string): void
}

export function PrototypeSwitcher({ variants, current, children, onChange }: PrototypeSwitcherProps) {
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  )
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length]
    if (next) onChange(next.key)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) return
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const shown = variants[index]
  return (
    <div className="proto-switcher">
      <div className="proto-switcher-bar">
        <button type="button" aria-label="Previous variant" onClick={() => step(-1)}>
          ←
        </button>
        <span>
          {shown?.key} · {shown?.name}
        </span>
        <button type="button" aria-label="Next variant" onClick={() => step(1)}>
          →
        </button>
      </div>
      {children}
    </div>
  )
}
