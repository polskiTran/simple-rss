import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// The design system's global invariants (docs/DESIGN.md §1), read off the
// stylesheet's declarations. Exact values and layout live in the browser tests.
let css: string

beforeAll(async () => {
  // Resolved from the project root: under jsdom, `import.meta.url` is an http: URL.
  css = await readFile(resolve(process.cwd(), 'src/client/styles.css'), 'utf8')
})

function declarations(property: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...code.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;{}]+)`, 'g'))].map(([, value]) =>
    (value ?? '').trim(),
  )
}

describe('colour', () => {
  it('is written in OKLCH and nothing else', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('binds each colour token once for both schemes', () => {
    const tokens = css.match(/--color-[\w-]+\s*:\s*[^;]+/g) ?? []
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) expect(token).toMatch(/:\s*(light-dark|var)\(/)
  })
})

/** Each colour token's light and dark values, `var()` aliases followed. */
function tokens(): Map<string, readonly [string, string]> {
  const raw = new Map(
    [...css.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value] as const),
  )
  const resolve = (name: string): readonly [string, string] => {
    const value = raw.get(name) ?? ''
    const alias = value.match(/^var\(--color-([\w-]+)\)$/)
    if (alias?.[1]) return resolve(alias[1])
    const pair = value.match(/^light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)$/)
    if (!pair?.[1] || !pair[2]) throw new Error(`--color-${name} is not a light-dark() pair`)
    return [pair[1], pair[2]]
  }
  return new Map([...raw.keys()].map((name) => [name, resolve(name)]))
}

/** WCAG relative luminance of an opaque `oklch(L% C h)`, through linear sRGB. */
function luminance(colour: string): number {
  const [lightness = 0, chroma = 0, hue = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number)
  const L = lightness / 100
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel))
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

// The pairs docs/DESIGN.md §2 promises, as [text, ground, least ratio].
const PROMISED: readonly (readonly [string, string, number])[] = [
  ['ink-2', 'ground', 4.5],
  ['ink-2', 'control', 4.5],
  ...['control', 'control-hover', 'toggle-off', 'segment'].map((fill) => ['ink-off', fill, 4.5] as const),
  ['ink-3', 'ink', 4.5],
  ['ramp-2', 'ground', 3],
  ...['ramp-1', 'ramp-2'].map((fill) => ['ink', fill, 4.5] as const),
  ...['ramp-3', 'ramp-4', 'ramp-5'].map((fill) => ['ground', fill, 4.5] as const),
  ...['ground', 'control', 'danger-fill'].map((fill) => ['danger', fill, 4.5] as const),
  ['feed-name', 'ground', 4.5],
  ['away', 'ground', 4.5],
  ['ink', 'match', 4.5],
]

describe('contrast', () => {
  it.each(['light', 'dark'] as const)('keeps every promised pair in %s', (mode) => {
    const colours = tokens()
    const side = mode === 'light' ? 0 : 1
    for (const [text, ground, least] of PROMISED) {
      const ratio = contrast(colours.get(text)?.[side] ?? '', colours.get(ground)?.[side] ?? '')
      expect(ratio, `${text} on ${ground}`).toBeGreaterThanOrEqual(least)
    }
  })
})

describe('shape', () => {
  it('has no rounded corners', () => {
    for (const value of declarations('border-radius')) expect(value).toBe('0')
  })

  it('never sets words in capitals', () => {
    expect(declarations('text-transform')).not.toContain('uppercase')
    for (const value of declarations('font-variant(?:-caps)?')) expect(value).not.toMatch(/small-caps/)
  })
})

/** Every rule's prelude, with the preludes of the blocks it is nested in. */
function rules(): { prelude: string; within: string[] }[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found: { prelude: string; within: string[] }[] = []
  const open: string[] = []
  let start = 0
  for (let at = 0; at < code.length; at++) {
    const char = code[at]
    if (char === '{') {
      const prelude = code.slice(start, at).trim()
      found.push({ prelude, within: [...open] })
      open.push(prelude)
    } else if (char === '}') open.pop()
    if (char === '{' || char === '}' || char === ';') start = at + 1
  }
  return found
}

describe('pointer', () => {
  // A tap reports a hover that never ends, so an ungated hover style sticks after it.
  it('styles hover only where a pointer can hover', () => {
    const hovers = rules().filter(({ prelude }) => prelude.includes(':hover'))
    expect(hovers.length).toBeGreaterThan(0)
    for (const { prelude, within } of hovers) {
      expect(
        within.some((outer) => /^@media[^{]*\(hover:\s*hover\)/.test(outer)),
        prelude,
      ).toBe(true)
    }
  })
})

describe('type', () => {
  it('keeps monospace out of the interface', () => {
    expect(css).not.toMatch(/monospace|ui-monospace|Menlo/)
  })
})
