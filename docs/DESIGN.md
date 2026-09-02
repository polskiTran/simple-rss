# simple — design system

Interactive behavior — focus, keyboard, trapping, dismissal — comes from Base UI
(`docs/adr/0008-interactive-behavior-from-base-ui.md`). This document describes
appearance and motion, not interaction.

## 1. Principles

1. **One shape, repeated.** A content item is a 21px line with a 12.5px grey line under it. Posts, feeds, saved items are all that shape. Filters differ; the object does not.
2. **Settings is not that shape.** It drops to a 13/14px two-column sheet so preferences can never be mistaken for reading.
3. **No dividers, no cards, no boxes.** Separation is whitespace only. The one rule in the system is the search field's underline.
4. **Colour is reserved.** Accent appears on saved state, the text cursor, and links inside an article. Danger accent on destructive action.
5. **Cadence is the unfair advantage.** Publishing rhythm — the thing only an RSS reader knows — is drawn as dot matrices at four ink levels. No charts, no curves, no colour.

## 2. Colour

### Light (paper)

| Role | Value |
| --- | --- |
| Paper | `#F7F7F5` |
| Ink — titles, active tab | `#12110F` |
| Ink — body prose | `#26251F` |
| Grey — metadata, inactive tabs, source | `#8C8B86` |
| Grey — quietest (save affordance, counts, month labels) | `#A3A29D` |
| Grey — muted prose / pull quote | `#6B6A66` |
| Accent (saved, cursor) | `#2438D8` |
| Danger (destructive action) | `#B02B27` |
| Hairline (search underline) | `rgba(18,17,15,.15)` |
| Dim (overlay backdrop) | `rgba(18,17,15,.28)` |

**Departure — one surface, not two.** No canvas is drawn behind the paper; the
paper is the whole field, edge to edge, in both schemes — a second tone shows
against a real viewport only as two vertical bands beside the column, a box by
another name, which §1 forbids.

### Dark (dark paper)

| Role | Value |
| --- | --- |
| Paper | `#12110F` |
| Ink — titles | `#F0EEE9` |
| Ink — wordmark, active tab | `#F7F7F5` |
| Grey — metadata | `#8C8B86` |
| Grey — quietest | `#6B6A66` |
| Accent (saved) | `#E3B341` |
| Danger (destructive action) | `#B02B27` |
| Dim (overlay backdrop) | `rgba(0,0,0,.52)` |

**Selection.** Selected text is the text cursor's range, so it shares the
caret's accent rather than the platform's blue: the accent at `.12` over light
paper, `.2` over dark. This is the cursor role §1 already grants the accent,
not a third use.

## 3. Type

Literata only. Weights 200 / 300 (default) / 500. Italic used for the wordmark, the secondary date heading, and pull quotes.

| Element | Desktop | 390px |
| --- | --- | --- |
| Wordmark | `italic 300 21px/1` | `italic 300 19px/1` |
| Tabs | `300 12.5px/1`, gap 24 | `300 12px/1`, gap 18 |
| Item title | `300 21px/1.42`, `text-wrap:pretty` | `300 19px/1.44` |
| Item meta row | `300 12.5px/1`, gap 20 | `300 12px/1`, gap 16 |
| Search field | `300 14px/1.4` | same |
| Section date (today) | `300 12.5px/1` | `300 12px/1` |
| Section date (past) | `italic 300 12.5px/1`, `#A3A29D` | same |
| Article title | `200 38px/1.18`, `letter-spacing:-.024em`, `text-wrap:balance` | — |
| Article body | `300 18.5px/1.74`, `#26251F` | — |
| Pull quote | `italic 300 18.5px/1.72`, `#6B6A66` | — |
| Stat line | `300 12.5px/1.6` | — |
| Axis labels | `300 11.5px/1`, `#A3A29D` | — |

## 4. Layout

The paper is 820px wide with 56px of side padding; the stylesheet carries the
rest of the rhythm. What follows is where the built layout departs from the
drawn one.

Dark paper takes 36px above the masthead where light takes 32px, at the desktop
width only. The four pixels are an optical correction and not a value that
escaped normalising: the masthead closes on a dark edge more tightly than on a
pale one.

**Departure — the measure.** Content — lists, the Reader, the daily band — is not
held to a measure narrower than the masthead, but runs the paper's own content
width (820 − 2×56 = 708px on desktop), because a narrower column leaves every
screen ragged against its own header on the right edge. The `.gate` forms keep
their own 310px; a password is not prose.

**Departure — the Reader's paper.** The Reader sits on the same paper and the
same measure as every other screen rather than the narrower one it was drawn on,
because swapping papers resized the masthead between screens and §5 holds that
the tabs never move. It keeps only its own inner rhythm — title scale, the 40px
header gap, no fixed height. Metadata sits *under* the title, not above. It ends
in "next in the digest" — never a dead stop.

**Departure — the global search line.** The line lives in the masthead on every
signed-in screen, including the Reader. Its DOM order is wordmark, search, tabs,
and the masthead is one row: the mark leads, the search line follows at a capped
340px, and the tabs keep the trailing edge — no control sits on a row of its
own. On the narrow paper one row cannot hold all three, so the tabs stay beside
the mark and the search line takes the full row below. The whole masthead
scrolls with the page rather than sticking, so it needs no occluding background.
The line uses the search underline `1px solid rgba(18,17,15,.15)` and a
1px × 14px accent caret.

The Feeds screen keeps its full-width line as the first control in the content
measure, `padding:8px 0 32px`, but its one job is adding: "add a feed by url"
accepts a Feed URL and nothing else — finding a Feed is the masthead line's job,
answered by the jump-to group. The two widths state that scope: the short
masthead line searches retained reading; the full-width Feeds line takes an
address. They repeat the same underline rather than inventing a second field
style.

**Departure — the line takes its scope from its screen.** Invoked from an
opened Feed, the line answers with that Feed's items alone; from the Library,
with saved items; from the Feeds screen, with matching Subscriptions and no
items. The Digest, the Reader and settings search everywhere. The placeholder
says which before the first keystroke — `search this feed`, `search your
saves`, `search your feeds`, `search your reading` — and once the words have
taken its place, a scoped results surface opens with one meta-grey line, `in
Field Notes · everywhere`. The `everywhere` word takes §5's grey-to-ink
treatment and re-asks the same words everywhere; clearing the line still lands
on the screen the search left. The empty state keeps that line above it, so the
way out is never further than the miss. A scoped search reads under its
section's tab — feeds, saved — and one everywhere under the Digest, so the
active tab and the scope line never disagree. There is no chip and no toggle:
the scope is read off the screen the search left and travels in the address,
`/search?q=notes&feed=2`, so a reloaded or shared search answers the same.

## 5. Components

### Wordmark
A 4×4 tile of 3px squares, `gap:2px`, then `simple` in italic at 10px gap.

The tile is drawn in the cadence ramp's five ink levels — `.06 / .20 / .38 / .60 / peak ink` — not in a second set of greys, so the mark is the cadence figure at mark size and §6's four-levels rule holds. Levels by row, `0`–`4` as the cadence grid numbers them:

```
4 1 3 0
2 4 0 2
3 0 4 1
0 2 1 3
```

The peak runs down the leading diagonal and then steps back to `.60` in the last cell, so the tile reads as a matrix with a direction rather than a rule drawn corner to corner. Peak ink here is the wordmark's own ink (§2: `#12110F`, dark `#F7F7F5`), the tone the name beside it is set in; the four tints are the ramp's.

The tile sits centred on the name's line box, which is what puts its bottom edge on the baseline at both type sizes.

### Tab bar
Four words, always in order: `digest · feeds · saved · settings`. Active is ink, rest are grey. The tabs never move or change between screens or breakpoints.

Exactly one word is active at a time, including while the Reader is open. The Reader has no tab of its own, so it borrows the section it was opened from: `saved` for a save, `feeds` for an item of an opened Feed, `digest` otherwise and when opened by address. That is the same section its way back names. An opened Feed always keeps `feeds`, however it was reached.

### Item
```
title       300 21px/1.42  #12110F
meta row    300 12.5px/1   #8C8B86, gap 20, margin-top 8
```
Meta contents by context: digest = source · time · save; single feed = date · save (source drops out, it's redundant); feeds list = domain.

Search results alone may add a line: when the match lives in the summary, its
plain-text fragment sits between the title and the meta row in the meta line's
own grey and size, `line-height:1.6` because it wraps. No markup and no accent —
the fragment itself is the evidence. A match the shape already shows — title or
source — draws nothing extra, and the item stays two lines.

Results scoped to one Feed are a single-Feed list and take its meta row: the
source drops out, `date · save`.

A search everywhere, or one scoped to the Feeds screen, may also open with a
jump-to group: matching Subscriptions as condensed feeds-list rows — a handful
everywhere, every match on the Feeds screen, where the group is the whole
answer. Each row is name at 16px, domain in meta grey beside it, and the
30-day cadence strip pinned to the row's trailing edge, so the strips form one
aligned column as they do on the Feeds list. The strip is what marks the
row as a Feed rather than an item at a glance. The name is the way in, the
domain the way out, and whitespace alone separates the group from the item
results below.

The source is the way into its Feed: in the Digest, in search results, in the Library, and in the Reader's meta row. It looks no different from the plain text it replaced — meta grey, no underline at rest — and on hover it steps to ink like §5's other grey words.

A save that outlived its Subscription is the exception. `The Slow Press · no longer subscribed` stays plain text, because there is no Feed left to open. Where the source does open, the link is the name alone, never the trailing clause.

The domain is the way out to the publisher's site, on the feeds list and in the opened Feed's header. It takes the source's grey-to-ink treatment, and because it leaves the installation it also takes §5's departure ↗ and `noopener noreferrer` — the mark is what tells the two apart, one row to the next. A Feed that declares no site of its own, or has not been retrieved yet, keeps the same words as plain text, unmarked.

### Save
Text affordance, never an icon. `save` in `#A3A29D` (dark: `#6B6A66`); `saved` in accent. Toggle in place, same width class, no animation.

### Cadence strip (feeds list)
30 days, one 6px square per day, `gap:2px`, aligned baseline-right of the feed name (`padding-bottom:4px`). At 390px it sits under the name, 14 days, beside the domain.

Four ink levels — never more:
`rgba(18,17,15,.06)` silent · `.20` one post · `.38` a few · `.60` busy · `#12110F` peak.

### Cadence grid (feed opened)
26 weeks as columns: 7 rows of 11px squares, `gap:3px` both axes, columns run left (oldest) to right (newest). A column is a day you can jump to. Month labels below at 11.5px, then a one-line stat: `167 posts in 26 weeks · busiest on wednesdays · longest quiet stretch 9 days`.

**Implementation notes.** Values the sections above do not state, fixed here so
the stylesheet has a source:

- At the narrow breakpoint the grid keeps all 26 × 7 cells — nothing hides —
  and the cell steps down one size: 9px squares, `gap:2px`, so the columns fit
  the 390px paper.
- A represented day is a button. Its keyboard focus is a 2px **accent** rule
  beneath the square: a square cannot take a text underline, and this is the
  text cursor's role — the mark of where the keyboard is — not a third accent
  use. The stat line's "posts" is likewise this design's display copy; the
  domain vocabulary keeps saying Feed Item.
- The opened Feed's header line (the way back, name in ink, domain) sits at 14px
  (13px narrow) with 40px to the content below.
  The way back is named after the screen it returns to: `← feeds` from the
  list, `← digest` from an item's source, `← article` from the Reader. The
  Reader's topline carries the same link in the same style. A screen opened by
  address falls back to the section it lives under.
  Retained items begin below the stat block on the same gap that opens a day
  group.
- Month labels are announced where a column opens a month, but never within
  six columns of the previous label; that spacing is what produces
  `february · april · june · august`.

### Daily band (digest)
A dithered field of 4px dots on a 5px pitch, drawn as one element with a long `box-shadow` list. It runs the full 708px content width (§4's measure departure) and is 114px tall — 23 rows of dots on the pitch. The height holds at every width: the container clips the field, so a narrow viewport shortens the band's length while its height never changes. It sits 34px below the header with the date line 40px under it.

Generation: value noise → ordered (Bayer) dither → four ink levels. Seeded by the date, so no two mornings repeat. Light levels `.07 / .16 / .30`; dark levels `.07 / .17 / .32 / .56`. It is decoration with a source — the day's own volume — not ornament.

**Implementation notes.** What the recipe above does not state:

- The day's volume sets *coverage*, not brightness. It lowers the bar the
  noise must clear to ink a cell, and the bar never drops so far that the
  paper stops showing through: the band is currents of ink in open
  paper, and adding volume to every cell instead fills it into a slab.
- The noise is two octaves — a long drift whose horizontal wavelength is far
  longer than its vertical one, which is what makes the field flow along the
  band, and a short grain that frays the currents' edges. Both are sampled
  skew to the pixel grid, so the noise lattice never lines up with a row of
  cells and prints it as a stripe.

In the reader it thins to a four-row strip above the article.

### Reader body

**Implementation notes.** Two values fixed against the prose above:

- The article opens straight from the metadata line into the first
  paragraph, so the daily band's four-row reader strip is deferred until a
  design pass actually draws it above an article.
- **The article's blocks are the Markdown renderer's, not this document's.**
  Streamdown draws the headings, lists, quotes, tables, and code, with its own
  classes and its own opinions: a fenced block is a framed card with its
  language, copy, download, and line numbers, and inline code is a filled
  pill. That is a deliberate departure from §1's "no dividers, no cards, no
  boxes", which still governs every other screen — following one renderer's
  standard beats maintaining a second design system against it. What this
  system supplies is the palette those classes resolve against, bound in both
  schemes, plus the measure and the prose type they inherit. A design pass may
  reclaim any of it later; until then the renderer leads and this section
  follows. Code is coloured by Shiki in Vitesse light and dark; a language the
  reader does not carry simply stays uncoloured. Interface chrome still never
  uses monospace.
- Article links take the accent, underlined, which is what the renderer's own
  link does and a third use of the accent beyond §1's two. `open original`
  stays interface chrome and keeps the ink. Both mark their departure with ↗
  and leave with `noopener noreferrer`; math is set with KaTeX at the size of the prose
  around it, never executed. A display equation wider than the measure scrolls
  in place, as the renderer's code and tables do, rather than widening the
  paper — and a
  numbered one keeps its number clear of the formula instead of hanging it at
  an edge the formula has already passed.

### Overlay

The same `var(--color-paper)` drawn again, with no border, no radius and no
shadow: the dimmed backdrop is the whole of its edge, so separation-by-whitespace
becomes separation-by-dim rather than an exception to it. One component at every
width — anchored to the bottom edge below 640px rather than swapped for a drawer,
because two interaction models for one question is where one design becomes two.

In at 150ms, out at 120ms, opacity only, both zero under
`prefers-reduced-motion`. An overlay is the one exception to the entrance-only
rule below; no other dismissal acquires an exit. *When* an overlay is permitted
is ADR 0008's rule, not this document's.

### Motion

The word the User presses answers instantly — the flip is the feedback: word
hovers, the active tab, the save word, and every dismissal but an overlay's
never ease. The mark is the exception, and the only one: it is not a word and
has no flip to give, so it answers in the vocabulary it is drawn in (see the
glint below). Otherwise motion belongs to arrivals. What a press summons, and
what the machine answers on its own clock, enters on a breath — opacity,
ease-out, never a show:

- A summoned view — a tab's screen, an opened Feed, the Reader — fades in
  over 150ms, opacity only: brief enough that the hundredth tab change
  still feels instant, present enough that the page never teleports.
  Entrance-only; nothing the User does ever waits on an exit.
- An article arriving from extraction (or its fallback) fades in over
  200ms, opacity only. The paper and the prose hold still.
- An overlay fades in over 150ms and out over 120ms, opacity only — the one
  motion in the system that runs on an exit (see Overlay above).
- A selected cadence day scrolls its items into view smoothly, so the jump
  reads as travel down the same list.
- **The mark's glint.** Hovered, the mark's sixteen cells step to another
  level of the same ramp and back — one pass along the anti-diagonal, 60ms
  between cells, 500ms for a cell's own rise and fall, `cubic-bezier(.23,1,
  .32,1)` — and the tile settles at its canonical levels while the pointer is
  still on it. Only where the mark is a link: on setup and login it holds
  still.
- **The wait.** Every waiting line — the digest, the library, a feed, the
  feeds list, an opening article, a running search — puts the same tile in
  front of its words, glinting on a loop: the same shape in the front 30% of
  a 1200ms turn, 60ms between cells, `linear`, still for the rest. The words
  say what is being waited on; the tile says it is still happening. The
  masthead mark stays out of it — two marks moving at once is the product
  fidgeting.

Under `prefers-reduced-motion` the overlay's fades and the scroll go instant and
the view fades remain — gentler, not zero. The glint on hover does not run at all; a
flicker has no gentler version. The wait is the one thing that cannot stop,
since "is anything still happening" is the only question it exists to answer,
so its cells hold still and the tile breathes on opacity instead.

## 6. Density rules

- Never more than four ink levels in a matrix.
- Never a border where whitespace will do.
- Never a second typeface.
- Never all caps mono font.
- No hairline design.
- Numbers appear only where they answer "is there something to read": post counts, quiet stretches. No engagement stats, no read time in lists (only in the reader header).

## 7. Breakpoints

Single breakpoint at 390px. Changes: type down one step, padding 56 → 24, cadence 30 days → 14, measure becomes full width. The daily band keeps its 114px height and only its clipped length follows the viewport. Structure is identical — nothing reflows, reorders, or hides.

**Implementation note.** 390px is the width the narrow layout is *drawn at*, not the width the media query fires at. A phone at 430px needs the narrow scale too, and the 820px paper stops being comfortable well above 390px, so the stylesheet switches at `max-width: 640px`. Every value inside the query is still the literal 390px column of the tables above.
