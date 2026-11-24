import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let css: string

beforeAll(async () => {
  const sheets = ['src/client/styles.css', 'src/client/screens/screens.css']
  css = (await Promise.all(sheets.map((sheet) => readFile(resolve(process.cwd(), sheet), 'utf8')))).join('\n')
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
    const bound = css.match(/--x-(?:paper|tone|tone-deep|ink|grey|wash)\s*:\s*[^;]+/g) ?? []
    expect(bound.length).toBe(6)
    for (const token of bound) expect(token).toMatch(/:\s*light-dark\(/)
  })
})

function tokens(): Map<string, readonly [string, string]> {
  const raw = new Map(
    [...css.matchAll(/--x-([\w-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [name, value.trim()] as const),
  )
  const resolve = (name: string): readonly [string, string] => {
    const value = raw.get(name) ?? ''
    const pair = value.match(/^light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)$/)
    if (pair?.[1] && pair[2]) return [pair[1], pair[2]]
    if (/^oklch\([^)]*\)$/.test(value)) return [value, value]
    throw new Error(`--x-${name} is not a colour`)
  }
  return new Map(
    [...raw.keys()].filter((name) => raw.get(name)?.includes('oklch')).map((name) => [name, resolve(name)]),
  )
}

function luminance(colour: string): number {
  const [lightness = 0, chroma = 0, hue = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number)
  const L = lightness > 1 ? lightness / 100 : lightness
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

interface ContrastPromise {
  readonly text: string
  readonly ground: string
  readonly leastRatio: number
}

const CONTRAST_PROMISES: readonly ContrastPromise[] = [
  { text: 'ink', ground: 'paper', leastRatio: 7 },
  { text: 'grey', ground: 'paper', leastRatio: 4.5 },
  { text: 'grey', ground: 'tone', leastRatio: 4 },
  { text: 'ink', ground: 'tone', leastRatio: 7 },
  { text: 'ink', ground: 'tone-deep', leastRatio: 7 },
  { text: 'ink', ground: 'wash', leastRatio: 7 },
  { text: 'pink-ink', ground: 'pink', leastRatio: 4.5 },
]

describe('contrast', () => {
  it.each(['light', 'dark'] as const)('keeps every promised pair in %s', (mode) => {
    const colours = tokens()
    const side = mode === 'light' ? 0 : 1
    for (const { text, ground, leastRatio } of CONTRAST_PROMISES) {
      const ratio = contrast(colours.get(text)?.[side] ?? '', colours.get(ground)?.[side] ?? '')
      expect(ratio, `${text} on ${ground}`).toBeGreaterThanOrEqual(leastRatio)
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
  it('gates every hover style on a pointer that can hover, so a tap leaves none stuck', () => {
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

function enclosing(code: string, at: number): string[] {
  const open: string[] = []
  let start = 0
  for (let index = 0; index < at; index++) {
    const char = code[index]
    if (char === '{') open.push(code.slice(start, index).trim())
    else if (char === '}') open.pop()
    if (char === '{' || char === '}' || char === ';') start = index + 1
  }
  return open
}

describe('type', () => {
  it('keeps monospace inside articles', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const uses = [...code.matchAll(/font-family:[^;]*monospace/g)]
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) expect(enclosing(code, use.index).join(' ')).toMatch(/article-body/)
  })
})
