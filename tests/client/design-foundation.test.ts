import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let css: string

beforeAll(async () => {
  // Resolved from the project root: under jsdom, `import.meta.url` is an http: URL.
  css = await readFile(resolve(process.cwd(), 'src/client/styles.css'), 'utf8')
})

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`\\n\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('colour', () => {
  it('is written in OKLCH and nothing else', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('binds each token once for both schemes, resolved by the document’s colour scheme', () => {
    const tokens = css.match(/\n\s*--color-[\w-]+:\s*oklch\(/g) ?? []
    expect(tokens).toHaveLength(0)
    expect(css).toMatch(/--color-ink:\s*light-dark\(oklch\(17\.8% 0 0\), oklch\(94\.6% 0 0\)\)/)
    expect(css).not.toContain('prefers-color-scheme: dark) {\n  :root')
  })

  it('lets the appearance choice pin a scheme against the device’s', () => {
    expect(block("html[data-appearance='light']")).toContain('color-scheme: light')
    expect(block("html[data-appearance='dark']")).toContain('color-scheme: dark')
    expect(block('html')).toContain('color-scheme: light dark')
  })

  it('makes the renderer’s `dark:` classes follow the pinned appearance', () => {
    expect(css).toContain('@custom-variant dark')
    expect(css).toContain("&:where([data-appearance='dark'], [data-appearance='dark'] *)")
    expect(css).toContain(":not([data-appearance='light'], [data-appearance='light'] *)")
  })
})

describe('shape', () => {
  it('has no rounded corners', () => {
    for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(value).toBe('0')
  })

  it('never sets words in capitals', () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/)
    expect(css).not.toMatch(/font-variant(-caps)?:\s*(all-)?small-caps/)
  })
})

describe('type', () => {
  it('operates in Instrument Sans and reads in Literata', () => {
    expect(block('body')).toContain('font-family: var(--font-ui)')
    expect(block('.item-title')).toContain('var(--font-read)')
    expect(block('.wordmark-name')).toContain('var(--font-read)')
  })

  it('keeps monospace out of the interface', () => {
    expect(css).not.toMatch(/monospace|ui-monospace|Menlo/)
  })
})

describe('motion under prefers-reduced-motion', () => {
  const reduced = () => css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

  it('opens and closes dialogs instantly', () => {
    expect(reduced()).toMatch(/\.dialog\[data-ending-style\]\s*\{\s*transition-duration: 0s/)
  })

  it('stops the mark’s glint but keeps the waiting tile breathing', () => {
    expect(reduced()).toMatch(/\.wordmark-cell\s*\{\s*animation: none/)
    expect(reduced()).toMatch(/\.loading-note \.wordmark-grid\s*\{\s*animation: loading-mark-breathe/)
  })
})
