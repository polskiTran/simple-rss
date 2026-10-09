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

/** Every `property: value` declaration of a property, value trimmed, comments ignored. */
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

describe('shape', () => {
  it('has no rounded corners', () => {
    for (const value of declarations('border-radius')) expect(value).toBe('0')
  })

  it('never sets words in capitals', () => {
    expect(declarations('text-transform')).not.toContain('uppercase')
    for (const value of declarations('font-variant(?:-caps)?')) expect(value).not.toMatch(/small-caps/)
  })
})

describe('type', () => {
  it('keeps monospace out of the interface', () => {
    expect(css).not.toMatch(/monospace|ui-monospace|Menlo/)
  })
})
