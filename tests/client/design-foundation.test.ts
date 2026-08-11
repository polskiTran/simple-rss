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

/** A CSS value made safe to drop into one of the regexes above. */
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

describe('the surface', () => {
  /**
   * `docs/DESIGN.md` §2 lists a light `App background (canvas around cards)` of
   * `#EDEDEA` under the paper. It is deliberately not bound — see the note in
   * that section. Against a fixed-width paper the second tone only ever reached
   * the screen as two vertical bands beside the column, which is a box by
   * another name (§1, principle 3). This holds the decision in place, because
   * re-adding a fill is a one-line change that looks harmless in review.
   */
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
    // One ramp, bound once: a second set of greys here would need a second
    // dark binding too, and would be the fifth ink level §6 rules out.
    // Every cell paints the level it rests at, so hover and wait can both
    // return to it without either restating the tile.
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
    // Every pointer-gated block, not the first: the sheet select has one of
    // its own, and the glint must be inside a gate wherever it is written.
    const hover = (css.match(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\n {2}\}/g) ?? []).join('\n')

    // `a.wordmark`, not `.wordmark`: the tile on setup and login leads
    // nowhere, so it stays still.
    expect(hover).toMatch(
      /a\.wordmark:hover \.wordmark-cell\s*\{[^}]*animation:\s*wordmark-glint 500ms cubic-bezier\(0\.23, 1, 0\.32, 1\) calc\(var\(--glint-step\) \* 60ms\)/,
    )
  })

  it('keeps the wait on the same glint, looping, and off the masthead mark', () => {
    // `.loading-note .wordmark-cell`, never `.wordmark-cell`: the mark in the
    // masthead holds still while something is loading. Two marks moving at
    // once is the product fidgeting.
    expect(lightOnly()).toMatch(
      /\.loading-note \.wordmark-cell\s*\{[^}]*animation:\s*wordmark-glint-loop 1200ms linear infinite calc\(var\(--glint-step\) \* 60ms\)/,
    )
    expect(lightOnly()).not.toMatch(/\n {2}\.wordmark-cell\s*\{[^}]*animation:\s*wordmark-glint-loop/)

    // The loop holds at rest for the back two-thirds of its turn. Without
    // that hold there is no breath between passes, and a mark with no breath
    // is a mark flashing rather than working.
    const keyframes = /@keyframes wordmark-glint-loop\s*\{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? ''
    expect(keyframes).toMatch(/0%,\s*30%,\s*100%\s*\{[^}]*background:\s*var\(--rest\)/)
    expect(keyframes).toMatch(/12%\s*\{[^}]*background:\s*var\(--glint\)/)
  })

  it('breathes the waiting tile rather than stopping it under reduced motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    // A loader that stops moving is a loader that lies, so this one is the
    // exception to the rule in the test above: the cells hold still and the
    // tile as a whole keeps saying something, on opacity alone.
    expect(reduced).toMatch(/\.loading-note \.wordmark-grid\s*\{[^}]*animation:\s*loading-mark-breathe/)
    expect(reduced).toMatch(/@keyframes loading-mark-breathe\s*\{[^}]*50%\s*\{[^}]*opacity:\s*0\.45/)
  })

  it('sends every cell to another level of the same ramp and back', () => {
    // The glint may not introduce a tone the mark does not already own, so
    // each level's destination is another entry in the same ramp — and the
    // keyframes leave both ends implicit, so the resting tile is stated once.
    const destinations = [
      ['.wordmark-cell', 'var(--cadence-2)'],
      [".wordmark-cell[data-level='1']", 'var(--cadence-3)'],
      [".wordmark-cell[data-level='2']", 'var(--color-ink-strong)'],
      // The two loud levels step down, so the matrix reshuffles rather than
      // merely brightening.
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
  it('steps type and padding down at the single breakpoint', () => {
    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

    expect(narrow).toMatch(/\.paper\s*\{[^}]*padding:\s*28px 24px 0/)
    expect(narrow).toMatch(/\.wordmark-name\s*\{[^}]*font-size:\s*19px/)
    expect(narrow).toMatch(/\.tab-bar\s*\{[^}]*gap:\s*18px/)
    expect(narrow).toMatch(/\.tab-bar\s*\{[^}]*font-size:\s*12px/)
    // Both columns are released together: below the breakpoint the content
    // measure and the authentication forms are the full width of the paper.
    expect(narrow).toMatch(/\.measure,\s*\n\s*\.gate\s*\{[^}]*max-width:\s*none/)
    // The OPML words tighten with the rest of the sheet scale.
    expect(narrow).toMatch(/\.opml-controls\s*\{[^}]*gap:\s*18px/)
    expect(narrow).toMatch(/\.opml-controls\s*\{[^}]*font-size:\s*12px/)
  })
})

describe('layout', () => {
  it('holds the paper to the design width, with the measure released to it', () => {
    expect(lightOnly()).toMatch(/\.paper\s*\{[^}]*max-width:\s*820px/)
    // `docs/DESIGN.md` §4 drew a 620px measure; rendered, a column narrower
    // than the masthead left every screen ragged against its own header. The
    // departure is recorded in §4: content runs the paper's width, so
    // re-tightening the measure is a decision, not a cleanup.
    expect(lightOnly()).toMatch(/\.measure\s*\{[^}]*max-width:\s*none/)
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
    expect(focusRules).toHaveLength(4)
    expect(suppressions).toHaveLength(4)
    expect(focusRules.join('\n')).toMatch(/border-bottom: 2px solid var\(--color-ink\)/)
    expect(focusRules.join('\n')).toMatch(/text-decoration: underline/)
    // A cadence cell cannot take an underline, so its focus is the accent
    // drawn as a rule beneath the square.
    expect(focusRules.join('\n')).toMatch(/border-bottom: 2px solid var\(--color-accent\)/)
  })
})

describe('the Feeds tab', () => {
  it('lets the search treatment scroll with the page, on the documented rhythm', () => {
    // `docs/DESIGN.md` §4 drew the field sticky on a paper background; the
    // departure is recorded there. Nothing floats over the paper, so no rule
    // may pin itself — this holds the whole stylesheet, not just the form.
    expect(css).not.toMatch(/position:\s*(sticky|fixed)/)
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
  it('holds the day-group rhythm and heading scale to the layout table', () => {
    // 44px above a date line, 24px below it — 32/20 at the narrow step.
    expect(lightOnly()).toMatch(/\.day-group \+ \.day-group\s*\{[^}]*margin-top:\s*44px/)
    expect(lightOnly()).toMatch(/\.day-heading\s*\{[^}]*margin:\s*0 0 24px/)
    expect(lightOnly()).toMatch(/\.day-heading\s*\{[^}]*font-size:\s*12\.5px/)
    expect(lightOnly()).toMatch(/\.day-heading-past\s*\{[^}]*font-style:\s*italic/)
    expect(lightOnly()).toMatch(/\.day-heading-past\s*\{[^}]*color:\s*var\(--color-quiet\)/)

    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/\.day-group \+ \.day-group\s*\{[^}]*margin-top:\s*32px/)
    expect(narrow).toMatch(/\.day-heading\s*\{[^}]*margin-bottom:\s*20px/)
    expect(narrow).toMatch(/\.day-heading\s*\{[^}]*font-size:\s*12px/)
  })

  it('keeps today’s count in the grey reserved for counts', () => {
    expect(lightOnly()).toMatch(/\.day-heading-count\s*\{[^}]*color:\s*var\(--color-quiet\)/)
  })

  it('draws the band 114px tall, 34px under the header, the date line 40px below', () => {
    expect(lightOnly()).toMatch(/\.daily-band\s*\{[^}]*height:\s*114px/)
    expect(lightOnly()).toMatch(/\.daily-band\s*\{[^}]*margin-bottom:\s*40px/)
    expect(lightOnly()).toMatch(/\.daily-band\s*\{[^}]*overflow:\s*hidden/)
    expect(lightOnly()).toMatch(/\.digest-view-today\s*\{[^}]*padding-top:\s*34px/)

    const narrow = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    // The band itself keeps its height; only the header gap steps down.
    expect(narrow).toMatch(/\.digest-view-today\s*\{[^}]*padding-top:\s*26px/)
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
    // `docs/DESIGN.md` §4 drew a 720px reader paper, but rendered, the swap
    // resized the masthead between screens — the one thing §5 says never
    // moves. The departure is recorded in §4; this holds the narrower card
    // from sneaking back, because it looks like a faithful revert in review.
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

  it('keeps the pull quote italic in the muted prose grey, indented by whitespace', () => {
    expect(lightOnly()).toMatch(/\.article-body blockquote\s*\{[^}]*font-style:\s*italic/)
    expect(lightOnly()).toMatch(/\.article-body blockquote\s*\{[^}]*color:\s*var\(--color-muted\)/)
    expect(lightOnly()).not.toMatch(/\.article-body blockquote\s*\{[^}]*border/)
  })

  it('confines the monospace exception to article code', () => {
    // The one departure from Literata `docs/DESIGN.md` §5 records: imported
    // code keeps its own voice. It must never leak into interface chrome.
    const monospace = css.match(/^\s*\.[^{}]*\{[^}]*ui-monospace[^}]*\}/gm) ?? []
    expect(monospace).toHaveLength(1)
    expect(monospace[0]).toContain('.article-body code')
  })

  it('breaks a word no space will break rather than widening the measure', () => {
    // An address or a hash longer than the narrow paper is the one thing that
    // can push the reading column sideways on a phone.
    expect(lightOnly()).toMatch(/\.article-body\s*\{[^}]*overflow-wrap:\s*break-word/)
    expect(lightOnly()).toMatch(/\.reader-title\s*\{[^}]*overflow-wrap:\s*break-word/)
    expect(lightOnly()).toMatch(/\.reader-summary\s*\{[^}]*overflow-wrap:\s*break-word/)
  })

  it('holds the departure arrow to its text form, never the colour emoji', () => {
    // Bare U+2197 is rendered by the emoji font on both mobile platforms; the
    // U+FE0E after it asks for the typographic glyph instead.
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
  /** The custom-property bindings inside a block of CSS, as `name: value`. */
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
