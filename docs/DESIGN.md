# simple — design system

Derived from turn 7. Every value below is literal; nothing is approximate.

## 1. Principles

1. **One shape, repeated.** A content item is a 21px line with a 12.5px grey line under it. Posts, feeds, saved items are all that shape. Filters differ; the object does not.
2. **Settings is not that shape.** It drops to a 13/14px two-column sheet so preferences can never be mistaken for reading.
3. **No dividers, no cards, no boxes.** Separation is whitespace only. The one rule in the system is the search field's underline.
4. **Colour is reserved.** Accent appears on saved state and the text cursor. Nowhere else.
5. **Cadence is the unfair advantage.** Publishing rhythm — the thing only an RSS reader knows — is drawn as dot matrices at four ink levels. No charts, no curves, no colour.

## 2. Colour

### Light (paper)

| Role | Value |
| --- | --- |
| App background (canvas around cards) | `#EDEDEA` |
| Paper | `#F7F7F5` |
| Ink — titles, active tab | `#12110F` |
| Ink — body prose | `#26251F` |
| Grey — metadata, inactive tabs, source | `#8C8B86` |
| Grey — quietest (save affordance, counts, month labels) | `#A3A29D` |
| Grey — muted prose / pull quote | `#6B6A66` |
| Accent (saved, cursor) | `#2438D8` |
| Hairline (search underline) | `rgba(18,17,15,.15)` |

### Dark (dark paper)

| Role | Value |
| --- | --- |
| Paper | `#12110F` |
| Ink — titles | `#F0EEE9` |
| Ink — wordmark, active tab | `#F7F7F5` |
| Grey — metadata | `#8C8B86` |
| Grey — quietest | `#6B6A66` |
| Accent (saved) | `#E3B341` |

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

| | Desktop | 390px |
| --- | --- | --- |
| Card | 820 × 760 | 390 × 760 |
| Padding | `32px 56px 0` (dark: `36px 56px 0`) | `28px 24px 0` |
| Content measure | `max-width:620px` | full width |
| Gap between items | 28px | 26px |
| Gap between day groups | 44px above the date, 24px below | 32 / 20 |
| Header → content | 48px (feeds), 34px (band), 40px (feed header) | 32 / 26 |

**Reader** is the one screen that breaks the card: 720px wide, `padding:32px 84px 64px`, no fixed height. Measure is 552px (720 − 168). Metadata sits *under* the title, not above. It ends in "next in the digest" — never a dead stop.

**Search** is sticky (`position:sticky;top:0`) with paper background, `padding:8px 0 32px`, `max-width:620px`, underline `1px solid rgba(18,17,15,.15)`, and a 1px × 14px accent caret.

## 5. Components

### Wordmark
A 3×3 grid of 3px squares, `gap:3px`, alternating ink / transparent starting ink (5 on, 4 off), then `simple` in italic at 10px gap.

### Tab bar
Four words, always in order: `digest · feeds · saved · settings`. Active is ink, rest are grey. The tabs never move or change between screens or breakpoints.

### Item
```
title       300 21px/1.42  #12110F
meta row    300 12.5px/1   #8C8B86, gap 20, margin-top 8
```
Meta contents by context: digest = source · time · save; single feed = date · save (source drops out, it's redundant); feeds list = domain.

### Save
Text affordance, never an icon. `save` in `#A3A29D` (dark: `#6B6A66`); `saved` in accent. Toggle in place, same width class, no animation.

### Cadence strip (feeds list)
30 days, one 6px square per day, `gap:2px`, aligned baseline-right of the feed name (`padding-bottom:4px`). At 390px it sits under the name, 14 days, beside the domain.

Four ink levels — never more:
`rgba(18,17,15,.06)` silent · `.20` one post · `.38` a few · `.60` busy · `#12110F` peak.

### Cadence grid (feed opened)
26 weeks as columns: 7 rows of 11px squares, `gap:3px` both axes, columns run left (oldest) to right (newest). A column is a day you can jump to. Month labels below at 11.5px, then a one-line stat: `167 posts in 26 weeks · busiest on wednesdays · longest quiet stretch 9 days`.

### Daily band (digest)
A dithered field of 4px dots on a 5px pitch, drawn as one element with a long `box-shadow` list. 64px tall on desktop, 54px at 390px, sits 34px below the header with the date line 40px under it.

Generation: value noise → ordered (Bayer) dither → four ink levels. Seeded by the date, so no two mornings repeat. Light levels `.07 / .16 / .30`; dark levels `.07 / .17 / .32 / .56`. It is decoration with a source — the day's own volume — not ornament.

In the reader it thins to a four-row strip above the article.

## 6. Density rules

- Never more than four ink levels in a matrix.
- Never a border where whitespace will do.
- Never a second typeface, never a second accent.
- Numbers appear only where they answer "is there something to read": post counts, quiet stretches. No engagement stats, no read time in lists (only in the reader header).

## 7. Breakpoints

Single breakpoint at 390px. Changes: type down one step, padding 56 → 24, cadence 30 days → 14, band 64px → 54px, measure becomes full width. Structure is identical — nothing reflows, reorders, or hides.

**Implementation note.** 390px is the width the narrow layout is *drawn at*, not the width the media query fires at. A phone at 430px needs the narrow scale too, and the 820px paper stops being comfortable well above 390px, so the stylesheet switches at `max-width: 640px`. Every value inside the query is still the literal 390px column of the tables above.
