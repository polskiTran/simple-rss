export const ARMS = ['n', 'e', 's', 'w'] as const
export type Arm = (typeof ARMS)[number]

export interface Size {
  readonly w: number
  readonly h: number
}

export interface Rect extends Size {
  readonly x: number
  readonly y: number
}

export interface Shape extends Rect {
  readonly radius: number
  readonly delay: number
}

export const SHAPE_NAMES = ['core', ...ARMS, 'stem-n', 'stem-e', 'stem-s', 'stem-w'] as const
type ShapeName = (typeof SHAPE_NAMES)[number]

export interface BloomLayout {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly shapes: Readonly<Record<ShapeName, Shape>>
  readonly boxes: Readonly<Record<Arm, Rect>>
}

export const COMPACT_BELOW = 700

const CORE = 44
const GAP = 28
const STEM = 46
const CLEAR = 30
const PINNED_ROW = 30
const LOBE: Size = { w: 72, h: 44 }
const NONE: Rect = { x: 0, y: 0, w: 0, h: 0 }
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e' } as const satisfies Record<Arm, Arm>

const shape = (rect: Rect, radius: number, delay = 0): Shape => ({ ...rect, radius, delay })

export function closedLayout(viewport: Size, hovered: boolean): BloomLayout {
  const lobe = 50
  const spread = hovered ? 42 : 37
  const at = (dx: number, dy: number) =>
    shape({ x: dx * spread - lobe / 2, y: dy * spread - lobe / 2, w: lobe, h: lobe }, lobe / 2)
  const rest = viewport.w < 760 ? 44 : 52
  return {
    x: viewport.w - rest,
    y: viewport.h - rest - PINNED_ROW,
    scale: 0.5,
    shapes: {
      core: shape({ x: -22, y: -22, w: 44, h: 44 }, 22),
      n: at(0, -1),
      e: at(1, 0),
      s: at(0, 1),
      w: at(-1, 0),
      'stem-n': shape(NONE, 0),
      'stem-e': shape(NONE, 0),
      'stem-s': shape(NONE, 0),
      'stem-w': shape(NONE, 0),
    },
    boxes: { n: NONE, e: NONE, s: NONE, w: NONE },
  }
}

function armSize(arm: Arm, panels: Readonly<Record<Arm, Size>>, compact: boolean, chosen: Arm | undefined): Size {
  if (!compact || chosen === arm || panels[arm].w === 0) return panels[arm]
  if (chosen !== undefined && OPPOSITE[chosen] === arm) return { w: 0, h: 0 }
  return LOBE
}

export function openLayout(
  viewport: Size,
  panels: Readonly<Record<Arm, Size>>,
  compact: boolean,
  chosen: Arm | undefined,
): BloomLayout {
  const size = (arm: Arm) => armSize(arm, panels, compact, chosen)
  const [n, e, s, w] = [size('n'), size('e'), size('s'), size('w')]
  const side = CORE + GAP
  const vertical = Math.max(side, w.h / 2 + CLEAR, e.h / 2 + CLEAR)
  const shown = (extent: Size, rect: Rect) => (extent.w > 0 ? rect : NONE)
  const boxes = {
    n: shown(n, { x: -n.w / 2, y: -vertical - n.h, ...n }),
    e: shown(e, { x: side, y: -e.h / 2, ...e }),
    s: shown(s, { x: -s.w / 2, y: vertical, ...s }),
    w: shown(w, { x: -side - w.w, y: -w.h / 2, ...w }),
  }
  const stems = {
    n: shown(n, { x: -STEM / 2, y: -vertical - CLEAR, w: STEM, h: vertical + CLEAR }),
    e: shown(e, { x: 0, y: -STEM / 2, w: side + CLEAR, h: STEM }),
    s: shown(s, { x: -STEM / 2, y: 0, w: STEM, h: vertical + CLEAR }),
    w: shown(w, { x: -side - CLEAR, y: -STEM / 2, w: side + CLEAR, h: STEM }),
  }

  const all = Object.values(boxes)
  const left = Math.min(-CORE, ...all.map((box) => box.x))
  const right = Math.max(CORE, ...all.map((box) => box.x + box.w))
  const top = Math.min(-CORE, ...all.map((box) => box.y))
  const bottom = Math.max(CORE, ...all.map((box) => box.y + box.h))
  const scale = Math.min(1, (viewport.w - 24) / (right - left), (viewport.h - 24) / (bottom - top))

  return {
    x: viewport.w / 2 - (scale * (left + right)) / 2,
    y: viewport.h / 2 - (scale * (top + bottom)) / 2,
    scale,
    shapes: {
      core: shape({ x: -CORE, y: -CORE, w: CORE * 2, h: CORE * 2 }, CORE),
      n: shape(boxes.n, 44, 40),
      e: shape(boxes.e, 44, 75),
      s: shape(boxes.s, 44, 110),
      w: shape(boxes.w, 44, 145),
      'stem-n': shape(stems.n, STEM / 2),
      'stem-e': shape(stems.e, STEM / 2),
      'stem-s': shape(stems.s, STEM / 2),
      'stem-w': shape(stems.w, STEM / 2),
    },
    boxes,
  }
}
