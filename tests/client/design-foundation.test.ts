import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * jsdom does not evaluate stylesheets, so the shell tests cannot see the
 * visual foundation. This reads the stylesheet itself and holds it against the
 * literal values in `docs/DESIGN.md` — enough to catch a token being edited,
 * dropped, or drifting from the design, which is what actually goes wrong.
 *
 * It is not a substitute for looking at the rendered page; it is a guard on
 * the numbers, which are the part a reviewer cannot eyeball.
 */
let css: string

beforeAll(async () => {
  // Resolved from the project root: under jsdom, `import.meta.url` is an
  // http: URL and cannot be handed to the filesystem.
  css = await readFile(resolve(process.cwd(), 'src/client/styles.css'), 'utf8')
})

/** The stylesheet with everything inside `prefers-color-scheme: dark` removed. */
function lightOnly(): string {
  return css.replace(/@media \(prefers-color-scheme: dark\)[^}]*\{[\s\S]*?\n\}/g, '')
}

function darkBlocks(): string {
  return (css.match(/@media \(prefers-color-scheme: dark\)[^}]*\{[\s\S]*?\n\}/g) ?? []).join('\n')
}

describe('the light palette', () => {
  it.each([
    ['app background', '--color-canvas', '#ededea'],
    ['paper', '--color-paper', '#f7f7f5'],
    ['ink — titles', '--color-ink', '#12110f'],
    ['ink — body prose', '--color-body', '#26251f'],
    ['grey — metadata', '--color-meta', '#8c8b86'],
    ['grey — quietest', '--color-quiet', '#a3a29d'],
    ['grey — muted prose', '--color-muted', '#6b6a66'],
    ['accent', '--color-accent', '#2438d8'],
  ])('binds %s through %s to %s', (_role, property, value) => {
    expect(lightOnly()).toContain(`${property}: ${value}`)
  })
})

describe('the dark palette', () => {
  it.each([
    ['paper', '--color-paper', '#12110f'],
    ['ink — titles', '--color-ink', '#f0eee9'],
    ['ink — wordmark and active tab', '--color-ink-strong', '#f7f7f5'],
    ['grey — metadata', '--color-meta', '#8c8b86'],
    ['grey — quietest', '--color-quiet', '#6b6a66'],
    ['accent', '--color-accent', '#e3b341'],
  ])('binds %s through %s to %s', (_role, property, value) => {
    expect(darkBlocks()).toContain(`${property}: ${value}`)
  })
})

describe('type', () => {
  it('uses Literata and nothing else', () => {
    expect(css).toContain("--font-serif: 'Literata'")
    expect(css).not.toMatch(/Inter|Helvetica|system-ui|sans-serif/)
  })

  it('loads only the weights the design uses, with italic at 300 only', () => {
    const imports = css.match(/@fontsource\/literata\/[a-z0-9-]+/g) ?? []

    expect(imports.sort()).toEqual([
      '@fontsource/literata/latin-200',
      '@fontsource/literata/latin-300',
      '@fontsource/literata/latin-300-italic',
      '@fontsource/literata/latin-500',
    ])
  })

  it('sets the desktop wordmark and tab sizes', () => {
    expect(lightOnly()).toMatch(/\.wordmark-name\s*\{[^}]*font-size:\s*21px/)
    expect(lightOnly()).toMatch(/\.tab-bar\s*\{[^}]*font-size:\s*12\.5px/)
    expect(lightOnly()).toMatch(/\.tab-bar\s*\{[^}]*gap:\s*24px/)
  })
})

describe('the narrow layout', () => {
  it('steps type and padding down at the single breakpoint', () => {
    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(narrow).toMatch(/\.paper\s*\{[^}]*padding:\s*28px 24px 0/)
    expect(narrow).toMatch(/\.wordmark-name\s*\{[^}]*font-size:\s*19px/)
    expect(narrow).toMatch(/\.tab-bar\s*\{[^}]*gap:\s*18px/)
    expect(narrow).toMatch(/\.tab-bar\s*\{[^}]*font-size:\s*12px/)
    // Both columns are released together: below the breakpoint the content
    // measure and the authentication forms are the full width of the paper.
    expect(narrow).toMatch(/\.measure,\s*\n\s*\.gate\s*\{[^}]*max-width:\s*none/)
  })
})

describe('layout', () => {
  it('holds the paper and the content measure to the design widths', () => {
    expect(lightOnly()).toMatch(/\.paper\s*\{[^}]*max-width:\s*820px/)
    expect(lightOnly()).toMatch(/\.measure\s*\{[^}]*max-width:\s*620px/)
    expect(lightOnly()).toMatch(/\.paper\s*\{[^}]*padding:\s*32px 56px 0/)
  })

  it('draws no cards or boxes — every rule in the system is an underline', () => {
    expect(css).not.toMatch(/box-shadow|border-radius/)

    // An underline is the one rule `docs/DESIGN.md` allows, taken from the
    // search field. A border on any other edge would be a card sneaking in.
    const borders = css.match(/border[a-z-]*:\s*[^;]+/g) ?? []
    const boxes = borders.filter((rule) => rule !== 'border: 0' && !rule.startsWith('border-bottom:'))

    expect(boxes).toEqual([])
  })

  it('binds the hairline to the documented 15% ink', () => {
    expect(lightOnly()).toContain('--color-hairline: rgb(18 17 15 / 0.15)')
  })

  it('replaces the browser focus ring rather than removing it', () => {
    const suppressions = css.match(/outline:\s*none/g) ?? []
    const focusRules = css.match(/:focus-visible[^{]*\{[^}]*\}/g) ?? []

    // Every `outline: none` must sit inside a `:focus-visible` block that
    // draws something in its place — minimalism is not a reason to make the
    // keyboard invisible.
    expect(focusRules).toHaveLength(2)
    expect(suppressions).toHaveLength(2)
    expect(focusRules.join('\n')).toMatch(/border-bottom: 2px solid var\(--color-ink\)/)
    expect(focusRules.join('\n')).toMatch(/text-decoration: underline/)
  })
})

describe('the authentication screens', () => {
  it('leaves the reading scale for the sheet scale, as Settings does', () => {
    expect(lightOnly()).toMatch(/\.field-input\s*\{[^}]*font-size:\s*14px/)
    expect(lightOnly()).toMatch(/\.field-label\s*\{[^}]*font-size:\s*13px/)
    expect(lightOnly()).toMatch(/\.text-button\s*\{[^}]*font-size:\s*13px/)
  })

  it('draws the text cursor in the accent, which is one of its two uses', () => {
    expect(lightOnly()).toMatch(/\.field-input\s*\{[^}]*caret-color:\s*var\(--color-accent\)/)
  })

  it('keeps affordances as words rather than filled controls', () => {
    expect(lightOnly()).toMatch(/\.text-button\s*\{[^}]*background:\s*none/)
  })
})
