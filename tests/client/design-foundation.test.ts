import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { BAND_HEIGHT_PX } from '../../src/client/components/daily-band.js'

// jsdom does not evaluate stylesheets, so these tests read styles.css directly
// and hold its token values against the literals in `docs/DESIGN.md`.
let css: string

beforeAll(async () => {
  // Resolved from the project root: under jsdom, `import.meta.url` is an http: URL.
  css = await readFile(resolve(process.cwd(), 'src/client/styles.css'), 'utf8')
})

function lightOnly(): string {
  return css.replace(/@media \(prefers-color-scheme: dark\)[^}]*\{[\s\S]*?\n\}/g, '')
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function darkBlocks(): string {
  return (css.match(/@media \(prefers-color-scheme: dark\)[^}]*\{[\s\S]*?\n\}/g) ?? []).join('\n')
}

describe('the light palette', () => {
  it.each([
    ['paper', '--color-paper', '#f7f7f5'],
    ['ink — titles', '--color-ink', '#12110f'],
    ['ink — body prose', '--color-body', '#26251f'],
    ['grey — metadata', '--color-meta', '#8c8b86'],
    ['grey — quietest', '--color-quiet', '#a3a29d'],
    ['grey — muted prose', '--color-muted-foreground', '#6b6a66'],
    ['accent', '--color-accent', '#2438d8'],
    ['dim — the overlay backdrop', '--color-dim', 'rgb(18 17 15 / 0.28)'],
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
    ['dim — the overlay backdrop', '--color-dim', 'rgb(0 0 0 / 0.52)'],
  ])('binds %s through %s to %s', (_role, property, value) => {
    expect(darkBlocks()).toContain(`${property}: ${value}`)
  })
})

describe('the surface', () => {
  it('is one tone in both schemes, with no canvas behind the paper', () => {
    expect(css).not.toContain('--color-canvas')
    expect(css).not.toContain('#ededea')
  })

  it('carries that tone on the document rather than on a column', () => {
    expect(lightOnly()).toMatch(/html\s*\{[^}]*background:\s*var\(--color-paper\)/)
    expect(lightOnly()).toMatch(/\n\s{2}body\s*\{[^}]*background:\s*var\(--color-paper\)/)
    expect(lightOnly()).not.toMatch(/\.paper\s*\{[^}]*background/)
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

  it('draws the wordmark tile as 4x4 3px squares on a 2px gap', () => {
    expect(lightOnly()).toMatch(/\.wordmark-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, 3px\)/)
    expect(lightOnly()).toMatch(/\.wordmark-grid\s*\{[^}]*gap:\s*2px/)
    expect(lightOnly()).toMatch(/\.wordmark-cell\s*\{[^}]*width:\s*3px/)
  })

  it('takes the tile’s tints from the cadence ramp and its peak from the wordmark ink', () => {
    expect(lightOnly()).toMatch(/\.wordmark-cell\s*\{[^}]*background:\s*var\(--rest\)/)
    expect(lightOnly()).toMatch(/\.wordmark-cell\s*\{[^}]*--rest: var\(--cadence-0\)/)
    for (const level of [1, 2, 3]) {
      expect(lightOnly()).toMatch(
        new RegExp(`\\.wordmark-cell\\[data-level='${level}'\\]\\s*\\{[^}]*--rest: var\\(--cadence-${level}\\)`),
      )
    }
    expect(lightOnly()).toMatch(/\.wordmark-cell\[data-level='4'\]\s*\{[^}]*--rest: var\(--color-ink-strong\)/)
  })

  it('glints the tile only for a pointer, and only where the mark is a link', () => {
    const hover = (css.match(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\n {2}\}/g) ?? []).join('\n')

    expect(hover).toMatch(
      /a\.wordmark:hover \.wordmark-cell\s*\{[^}]*animation:\s*wordmark-glint 500ms cubic-bezier\(0\.23, 1, 0\.32, 1\) calc\(var\(--glint-step\) \* 60ms\)/,
    )
  })

  it('keeps the wait on the same glint, looping, and off the masthead mark', () => {
    expect(lightOnly()).toMatch(
      /\.loading-note \.wordmark-cell\s*\{[^}]*animation:\s*wordmark-glint-loop 1200ms linear infinite calc\(var\(--glint-step\) \* 60ms\)/,
    )
    expect(lightOnly()).not.toMatch(/\n {2}\.wordmark-cell\s*\{[^}]*animation:\s*wordmark-glint-loop/)

    const keyframes = /@keyframes wordmark-glint-loop\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? ''
    expect(keyframes).toMatch(/0%,\s*30%,\s*100%\s*\{[^}]*background:\s*var\(--rest\)/)
    expect(keyframes).toMatch(/12%\s*\{[^}]*background:\s*var\(--glint\)/)
  })

  it('breathes the waiting tile rather than stopping it under reduced motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(reduced).toMatch(/\.loading-note \.wordmark-grid\s*\{[^}]*animation:\s*loading-mark-breathe/)
    expect(reduced).toMatch(/@keyframes loading-mark-breathe\s*\{[^}]*50%\s*\{[^}]*opacity:\s*0\.45/)
  })

  it('sends every cell to another level of the same ramp and back', () => {
    const destinations = [
      ['.wordmark-cell', 'var(--cadence-2)'],
      [".wordmark-cell[data-level='1']", 'var(--cadence-3)'],
      [".wordmark-cell[data-level='2']", 'var(--color-ink-strong)'],
      [".wordmark-cell[data-level='3']", 'var(--cadence-1)'],
      [".wordmark-cell[data-level='4']", 'var(--cadence-2)'],
    ] as const

    for (const [selector, destination] of destinations) {
      expect(lightOnly()).toMatch(new RegExp(`${escaped(selector)}\\s*\\{[^}]*--glint: ${escaped(destination)}`))
    }

    const keyframes = /@keyframes wordmark-glint\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? ''
    expect(keyframes).toMatch(/30%\s*\{[^}]*background:\s*var\(--glint\)/)
    expect(keyframes).not.toMatch(/(^|\D)(0%|100%|from|to)/)
  })

  it('does not glint at all under reduced motion — a flicker has no gentler version', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(reduced).toMatch(/\.wordmark-cell\s*\{[^}]*animation:\s*none/)
  })

  it('sets the desktop wordmark and tab sizes', () => {
    expect(lightOnly()).toMatch(/\.wordmark-name\s*\{[^}]*font-size:\s*21px/)
    expect(lightOnly()).toMatch(/\.tab-bar\s*\{[^}]*font-size:\s*12\.5px/)
    expect(lightOnly()).toMatch(/\.tab-bar\s*\{[^}]*gap:\s*24px/)
  })
})

describe('the narrow layout', () => {
  it('steps type down and releases the measure at the single breakpoint', () => {
    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(narrow).toMatch(/\.wordmark-name\s*\{[^}]*font-size:\s*19px/)
    expect(narrow).toMatch(/\.tab-bar\s*\{[^}]*gap:\s*18px/)
    expect(narrow).toMatch(/\.tab-bar\s*\{[^}]*font-size:\s*12px/)
    expect(narrow).toMatch(/\.measure,\s*\n\s*\.gate\s*\{[^}]*max-width:\s*none/)
    expect(narrow).toMatch(/\.opml-controls\s*\{[^}]*gap:\s*18px/)
    expect(narrow).toMatch(/\.opml-controls\s*\{[^}]*font-size:\s*12px/)
  })
})

describe('layout', () => {
  it('holds the paper to the design width, with the measure released to it', () => {
    expect(lightOnly()).toMatch(/\.paper\s*\{[^}]*max-width:\s*820px/)
    expect(lightOnly()).toMatch(/\.measure\s*\{[^}]*max-width:\s*none/)
  })

  it('gives dark paper four more pixels above the masthead than light', () => {
    expect(lightOnly()).toMatch(/\.paper\s*\{[^}]*padding:\s*32px 56px 0/)
    expect(darkBlocks()).toMatch(/\.paper\s*\{[^}]*padding:\s*36px 56px 0/)
    expect(css).toMatch(/\[data-appearance='dark'\] \.paper\s*\{[^}]*padding:\s*36px 56px 0/)
  })

  it('draws no cards or boxes in the interface — every rule here is an underline', () => {
    const drawn = css.replace(/--[a-z-]+:[^;]+;/g, '')

    expect(drawn).not.toMatch(/box-shadow|border-radius/)

    const borders = drawn.match(/border[a-z-]*:\s*[^;]+/g) ?? []
    const boxes = borders.filter((rule) => rule !== 'border: 0' && !rule.startsWith('border-bottom:'))

    expect(boxes).toEqual([])
  })

  it('binds the hairline to the documented 15% ink', () => {
    expect(lightOnly()).toContain('--color-hairline: rgb(18 17 15 / 0.15)')
  })

  it('replaces the browser focus ring rather than removing it', () => {
    const suppressions = css.match(/outline:\s*none/g) ?? []
    const focusRules = css.match(/:focus-visible[^{]*\{[^}]*\}/g) ?? []

    expect(focusRules).toHaveLength(4)
    expect(suppressions).toHaveLength(4)
    expect(focusRules.join('\n')).toMatch(/border-bottom: 2px solid var\(--color-ink\)/)
    expect(focusRules.join('\n')).toMatch(/text-decoration: underline/)
    expect(focusRules.join('\n')).toMatch(/border-bottom: 2px solid var\(--color-accent\)/)
  })
})

describe('the Feeds tab', () => {
  it('lets the search treatment scroll with the page, on the documented rhythm', () => {
    // Nothing sticks to the viewport. `position: fixed` is not collateral here:
    // the overlay is the one thing drawn over the paper (DESIGN.md §5), and it
    // is the backdrop and the viewport, nothing else.
    expect(css).not.toMatch(/position:\s*sticky/)
    expect(css.match(/position:\s*fixed/g) ?? []).toHaveLength(1)
    expect(css).toMatch(/\.overlay-backdrop,\n\s*\.overlay-viewport\s*\{[^}]*position:\s*fixed/)
    expect(lightOnly()).toMatch(/\.search-form\s*\{[^}]*padding:\s*8px 0 32px/)
  })

  it('draws the cadence grid at 11px cells on a 3px gap, one step smaller when narrow', () => {
    expect(lightOnly()).toMatch(/\.cadence-figure\s*\{[^}]*--cadence-cell:\s*11px/)
    expect(lightOnly()).toMatch(/\.cadence-figure\s*\{[^}]*--cadence-gap:\s*3px/)

    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/\.cadence-figure\s*\{[^}]*--cadence-cell:\s*9px/)
  })

  it('keeps the month labels and stat line on the documented axis scale', () => {
    expect(lightOnly()).toMatch(/\.cadence-month\s*\{[^}]*font-size:\s*11\.5px/)
    expect(lightOnly()).toMatch(/\.cadence-stats\s*\{[^}]*font-size:\s*12\.5px/)
  })
})

describe('the Digest', () => {
  it('holds the day heading to the §3 type table, italic and quiet when past', () => {
    expect(lightOnly()).toMatch(/\.day-heading\s*\{[^}]*font-size:\s*12\.5px/)
    expect(lightOnly()).toMatch(/\.day-heading-past\s*\{[^}]*font-style:\s*italic/)
    expect(lightOnly()).toMatch(/\.day-heading-past\s*\{[^}]*color:\s*var\(--color-quiet\)/)

    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/\.day-heading\s*\{[^}]*font-size:\s*12px/)
  })

  it('keeps today’s count in the grey reserved for counts', () => {
    expect(lightOnly()).toMatch(/\.day-heading-count\s*\{[^}]*color:\s*var\(--color-quiet\)/)
  })

  it('draws the band 114px tall, 34px under the header, the date line 40px below', () => {
    expect(BAND_HEIGHT_PX).toBe(114)
    expect(lightOnly()).toMatch(/\.daily-band\s*\{[^}]*height:\s*var\(--daily-band-height\)/)
    expect(lightOnly()).toMatch(/\.daily-band\s*\{[^}]*margin-bottom:\s*40px/)
    expect(lightOnly()).toMatch(/\.daily-band\s*\{[^}]*overflow:\s*hidden/)
    expect(lightOnly()).toMatch(/\.digest-view-today\s*\{[^}]*padding-top:\s*34px/)

    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).not.toMatch(/\.daily-band\s*\{/)
  })

  it('binds the band ink levels to the documented light and dark values', () => {
    expect(lightOnly()).toContain('--band-0: rgb(18 17 15 / 0.07)')
    expect(lightOnly()).toContain('--band-1: rgb(18 17 15 / 0.16)')
    expect(lightOnly()).toContain('--band-2: rgb(18 17 15 / 0.3)')

    expect(darkBlocks()).toContain('--band-0: rgb(240 238 233 / 0.07)')
    expect(darkBlocks()).toContain('--band-1: rgb(240 238 233 / 0.17)')
    expect(darkBlocks()).toContain('--band-2: rgb(240 238 233 / 0.32)')
    expect(darkBlocks()).toContain('--band-3: rgb(240 238 233 / 0.56)')
  })
})

describe('the Reader', () => {
  it('shares the one paper — no second, narrower card for the article', () => {
    expect(css).not.toContain('paper-reader')
  })

  it('sets the article title and body to the §3 type table', () => {
    expect(lightOnly()).toMatch(/\.reader-title\s*\{[^}]*font-weight:\s*200/)
    expect(lightOnly()).toMatch(/\.reader-title\s*\{[^}]*font-size:\s*38px/)
    expect(lightOnly()).toMatch(/\.reader-title\s*\{[^}]*letter-spacing:\s*-0?\.024em/)
    expect(lightOnly()).toMatch(/\.article-body\s*\{[^}]*font-size:\s*18\.5px/)
    expect(lightOnly()).toMatch(/\.article-body\s*\{[^}]*line-height:\s*1\.74/)
    expect(lightOnly()).toMatch(/\.article-body\s*\{[^}]*color:\s*var\(--color-body\)/)
  })

  it('leaves the article’s blocks to the Markdown renderer', () => {
    expect(css).toContain('@source "../../node_modules/streamdown/dist/*.js"')
    expect(lightOnly()).not.toMatch(/\.article-body (blockquote|table|th|td|hr|h[1-6]|pre|code|ul|ol)[\s,]*\{/)
  })

  it('binds the renderer’s tokens to this palette, in both schemes', () => {
    for (const token of ['--color-background', '--color-foreground', '--color-border', '--color-primary']) {
      expect(lightOnly()).toContain(`${token}:`)
    }
    for (const token of ['--color-muted', '--color-muted-foreground', '--color-sidebar']) {
      expect(lightOnly()).toContain(`${token}:`)
      expect(darkBlocks()).toContain(`${token}:`)
    }
  })

  it('keeps monospace out of this stylesheet — code’s own voice is the renderer’s', () => {
    expect(css).not.toMatch(/monospace/)
  })

  it('makes the renderer’s `dark:` classes follow the pinned appearance', () => {
    const variant = /@custom-variant dark \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(variant).toContain('@media (prefers-color-scheme: dark)')
    expect(variant).toContain("[data-appearance='light']")
    expect(variant).toContain("[data-appearance='dark']")
  })

  it('breaks a word no space will break rather than widening the measure', () => {
    expect(lightOnly()).toMatch(/\.article-body\s*\{[^}]*overflow-wrap:\s*break-word/)
    expect(lightOnly()).toMatch(/\.reader-title\s*\{[^}]*overflow-wrap:\s*break-word/)
    expect(lightOnly()).toMatch(/\.reader-summary\s*\{[^}]*overflow-wrap:\s*break-word/)
  })

  it('holds the departure arrow to its text form, never the colour emoji', () => {
    // Bare U+2197 renders in the emoji font on both mobile platforms; the
    // trailing U+FE0E forces the text glyph.
    const arrows = css.match(/content:\s*'[^']*2197[^']*'/g) ?? []
    expect(arrows.length).toBeGreaterThan(0)
    for (const arrow of arrows) expect(arrow).toContain('\\2197\\FE0E')
  })

  it('leaves a linked image unmarked — no underline, no arrow', () => {
    expect(lightOnly()).toMatch(/\.article-link:has\(\.article-image\)\s*\{[^}]*text-decoration:\s*none/)
    expect(lightOnly()).toMatch(/\.article-link:has\(\.article-image\)::after\s*\{[^}]*content:\s*none/)
  })

  it('steps the reader down with everything else at the breakpoint', () => {
    const narrow = css.split('@media (max-width: 640px)')[1] ?? ''
    expect(narrow).toMatch(/\.reader-title\s*\{[^}]*font-size:\s*29px/)
  })
})

describe('pinned appearance', () => {
  function bindings(block: string): string[] {
    return (block.match(/--[a-z0-9-]+:\s*[^;]+/g) ?? []).sort()
  }

  it('rebinds exactly the tokens the dark media block binds — no drift', () => {
    const pinned = /:root\[data-appearance='dark'\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(bindings(pinned)).toEqual(bindings(darkBlocks()))
    expect(bindings(pinned).length).toBeGreaterThan(0)
  })

  it('lets a pinned light opt out of the device dark preference', () => {
    expect(darkBlocks()).toContain(":root:not([data-appearance='light'])")
  })

  it('pins the browser’s own scheme along with the tokens', () => {
    expect(css).toMatch(/html\[data-appearance='light'\]\s*\{[^}]*color-scheme:\s*light/)
    expect(css).toMatch(/html\[data-appearance='dark'\]\s*\{[^}]*color-scheme:\s*dark/)
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
