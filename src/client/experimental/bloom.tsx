import { Dialog } from '@base-ui/react/dialog'
import {
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  use,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { hasOwn } from '../../shared/record.js'
import { editable } from '../components/global-search.js'
import {
  type Arm,
  ARMS,
  type BloomLayout,
  closedLayout,
  COMPACT_BELOW,
  openLayout,
  type Rect,
  SHAPE_NAMES,
  type Shape,
  type Size,
} from './bloom-geometry.js'

export const BloomState = createContext({ open: false, close: () => {} })

type SlotSide = Exclude<Arm, 'n'>

export const ArmSlots = createContext<Readonly<Record<SlotSide, HTMLElement | null>>>({
  e: null,
  s: null,
  w: null,
})

export function ArmContent({ side, children }: { readonly side: SlotSide; readonly children: ReactNode }) {
  const slot = use(ArmSlots)[side]
  return slot ? createPortal(children, slot) : null
}

const LOBE_LABELS = { n: 'Go', e: 'Search', s: 'Time', w: 'View' } as const satisfies Record<Arm, string>
const PANEL_LABELS = { n: 'Places', e: 'Search and actions', s: 'Time', w: 'View' } as const satisfies Record<
  Arm,
  string
>
const ARROW_ARMS = { ArrowUp: 'n', ArrowRight: 'e', ArrowDown: 's', ArrowLeft: 'w' } as const satisfies Record<
  string,
  Arm
>
const NO_SIZES = {
  n: { w: 0, h: 0 },
  e: { w: 0, h: 0 },
  s: { w: 0, h: 0 },
  w: { w: 0, h: 0 },
} satisfies Record<Arm, Size>

interface BloomProps {
  readonly open: boolean
  readonly ownsSlash: boolean
  readonly panels: Readonly<Record<Arm, ReactNode>>
  onOpenChange(open: boolean): void
}

export function Bloom({ open, ownsSlash, panels, onOpenChange }: BloomProps) {
  const viewport = useViewport()
  const compact = viewport.w < COMPACT_BELOW
  const [chosen, setChosen] = useState<Arm>()
  const [hovered, setHovered] = useState(false)
  const [sizes, setSizes] = useState<Readonly<Record<Arm, Size>>>(NO_SIZES)
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  const panelElements = useRef<Partial<Record<Arm, HTMLElement | null>>>({})
  const core = useRef<HTMLButtonElement>(null)

  const layout = open ? openLayout(viewport, sizes, compact, chosen) : closedLayout(viewport, hovered)
  const resting = closedLayout(viewport, false)

  const change = (next: boolean, arm?: Arm) => {
    if (next) setChosen(arm)
    onOpenChange(next)
  }

  const [resizes] = useState(
    () =>
      new ResizeObserver((entries) => {
        const measured = entries.flatMap(({ target }) => {
          if (!(target instanceof HTMLElement)) return []
          const arm = ARMS.find((candidate) => candidate === target.dataset.arm)
          return arm ? [{ arm, w: target.offsetWidth, h: target.offsetHeight }] : []
        })
        setSizes((current) => {
          const changed = measured.filter(({ arm, w, h }) => current[arm].w !== w || current[arm].h !== h)
          if (changed.length === 0) return current
          const sizeOf = (arm: Arm): Size => changed.find((size) => size.arm === arm) ?? current[arm]
          return { n: sizeOf('n'), e: sizeOf('e'), s: sizeOf('s'), w: sizeOf('w') }
        })
      }),
  )

  useLayoutEffect(() => {
    if (!open) return
    const sizeOf = (arm: Arm): Size => {
      const panel = panelElements.current[arm]
      return { w: panel?.offsetWidth ?? 0, h: panel?.offsetHeight ?? 0 }
    }
    const next = { n: sizeOf('n'), e: sizeOf('e'), s: sizeOf('s'), w: sizeOf('w') }
    setSizes((current) =>
      ARMS.every((arm) => current[arm].w === next[arm].w && current[arm].h === next[arm].h) ? current : next,
    )
  }, [open, chosen])

  const shortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || editable(event.target)) return
    if (event.key === '.') {
      event.preventDefault()
      change(!open)
    } else if (event.key === '/' && ownsSlash) {
      event.preventDefault()
      if (open) focusFirst('e')
      else change(true, 'e')
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])

  const focusFirst = (arm: Arm) =>
    panelElements.current[arm]
      ?.querySelector<HTMLElement>('input, a[href], button:not([disabled]):not([aria-disabled="true"])')
      ?.focus()

  const enter = (arm: Arm) => {
    if (compact) flushSync(() => setChosen(arm))
    focusFirst(arm)
  }

  const fromCore = (event: KeyboardEvent<HTMLElement>) => {
    if (!hasOwn(ARROW_ARMS, event.key) || event.target !== core.current) return
    event.preventDefault()
    enter(ARROW_ARMS[event.key])
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => change(next)}>
      <div className="x x-bloom">
        <svg className="x-bloom-filter" aria-hidden="true" width="0" height="0">
          <filter id="x-goo" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blurred" />
            <feColorMatrix in="blurred" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -13" />
          </filter>
        </svg>
        <div className="x-bloom-body" style={placed(layout)}>
          <div className="x-bloom-scale">
            <div className="x-bloom-shapes" aria-hidden="true">
              {SHAPE_NAMES.map((name) => (
                <i key={name} style={shapeStyle(layout.shapes[name], open)} />
              ))}
            </div>
            <Dialog.Trigger
              className="x-bloom-hit"
              aria-label="Open the menu"
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
            />
          </div>
        </div>
        <div ref={setPortal} />
      </div>
      {portal ? (
        <Dialog.Portal container={portal} keepMounted>
          <Dialog.Backdrop className="x-bloom-scrim" />
          <Dialog.Popup
            className="x x-bloom-popup"
            aria-label="Menu"
            initialFocus={() => (chosen === 'e' ? searchIn(panelElements.current.e) : core.current)}
            style={{ ...placed(layout), '--from-x': `${resting.x}px`, '--from-y': `${resting.y}px` }}
            onKeyDown={fromCore}
          >
            <div className="x-bloom-scale">
              {ARMS.map((arm) => (
                <section
                  key={arm}
                  ref={(element) => {
                    panelElements.current[arm] = element
                    if (!element) return
                    resizes.observe(element)
                    return () => resizes.unobserve(element)
                  }}
                  className="x-panel"
                  data-arm={arm}
                  data-hidden={compact && chosen !== arm ? '' : undefined}
                  aria-label={PANEL_LABELS[arm]}
                  style={at(layout.boxes[arm])}
                >
                  {panels[arm]}
                </section>
              ))}
              {compact
                ? ARMS.map((arm) => (
                    <button
                      key={arm}
                      type="button"
                      className="x-lobe"
                      data-shown={chosen !== arm && layout.boxes[arm].w > 0 ? '' : undefined}
                      style={at(layout.boxes[arm])}
                      onClick={() => enter(arm)}
                    >
                      {LOBE_LABELS[arm]}
                    </button>
                  ))
                : null}
              <Dialog.Close ref={core} className="x-bloom-core" aria-label="Close the menu" />
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  )
}

function searchIn(panel: HTMLElement | null | undefined): HTMLElement | null {
  return panel?.querySelector('input') ?? null
}

function placed(layout: BloomLayout): CSSProperties {
  return { '--x': `${layout.x}px`, '--y': `${layout.y}px`, '--scale': layout.scale }
}

function at(box: Rect): CSSProperties {
  return { left: box.x, top: box.y }
}

function shapeStyle(shape: Shape, open: boolean): CSSProperties {
  return {
    transform: `translate(${shape.x}px, ${shape.y}px)`,
    width: shape.w,
    height: shape.h,
    borderRadius: shape.radius,
    transitionDelay: `${open ? shape.delay : 0}ms`,
  }
}

function useViewport(): Size {
  const [viewport, setViewport] = useState<Size>(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const resize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  return viewport
}
