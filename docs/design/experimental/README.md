# Experimental interface

The experimental interface is chosen per device in Settings under Interface
(ADR 0032). It draws the Digest, a Feed and the Reader View; every other screen
is the v2 view, reached from the bloom's Go arm. `index.html` is the prototype
it was ported from, opened from disk with data exported by
`export-dev-data.mjs` into `.data/`. The stylesheet is
`src/client/experimental/experimental.css`; this file records what it does.

## System

- **Type.** Geist at 13px on an 18px line, everywhere but the Reader View's
  title and body, which set 17px on 28px (15/25 and 19/31 under Text size).
  Weight 500 marks the current place and the Reader View's title; nothing is
  set in capitals. Code is Geist Mono.
- **Grid.** Twelve flush columns with a 12px gutter and a 12px page inset, no
  maximum width. A row is label (columns 1–2), main (3–8), side (9–10) and end
  (11–12). Below 760px every column spans the page.
- **Surfaces.** No hairlines, borders, radii or shadows. Separation is space
  and tone: `--x-tone` under a hovered or focused row, and an unfolded fold.
- **Colour.** OKLCH, greyscale paper and ink, warm hue 95. Colour appears only
  in data: a Feed's name and Cadence take its Rhythm's colour — Firehose
  `oklch(0.63 0.19 35)`, Daily `oklch(0.78 0.14 82)`, Weekly
  `oklch(0.62 0.12 150)`, Monthly `oklch(0.52 0.08 250)`, Inactive grey — with
  lightness capped at 0.62 on light paper so Daily stays legible. Saved is the
  bloom's pink: a saved row sits on a pink wash and shows the word Saved beside
  its time. Dark follows Appearance through `light-dark()`.

## Digest

The ledger row names the Digest, counts its Feed Items and Subscriptions, keys
the Rhythm colours and dates the day shown. Days follow as rows: title, Feed,
time, with Save revealed on hover or keyboard focus. A Quiet Spell's end is a
grey line at the top of its day. A sticky legend at the bottom names the
columns. Show older days pages by whole days (ADR 0011).

A Firehose Feed is treated one of two ways, chosen in the View arm and kept per
device:

- **Fold** (default). Each Firehose Feed's Feed Items for the day become one
  row where its latest stands: the count, the latest title in grey, the Feed,
  and the span of times. A Firehose Feed with one Feed Item that day stays a
  plain row. Unfolded, the fold is one toned drawer: its head says Fold and the
  count, and its rows give title and time, never the Feed again. Which folds
  stand open is kept on the history entry (ADR 0028).
- **Lane.** The day's Firehose Feed Items move to the last three columns, as
  tall as the day's own rows and scrolled inside it; the rows narrow to make
  room. On a phone the Lane follows the day's rows.

## Feed

A ledger: the Feed's name in its Rhythm colour and when it was last checked,
home page, description, Rhythm with its count over the last 30 days,
availability, Polling Interval and Reading Source as words, the date
subscribed, and 26 weeks of Cadence as hard 9px squares, each day with items a
button that brings that day into view. Its Feed Items follow by day without a
Feed column.

## Reader View

The wall label on the left: the way back, the Feed, the day and time, reading
time, the Reading Source shown, the Discussion, Save, and how far read. The
title and body in the main columns, at most 66ch. With three or more headings,
an outline on the right follows the reading position. Next is pinned to the
bottom edge in the Digest's columns. Next and `j` follow the Digest's folding:
from a quiet Feed they skip the Firehose, from a Firehose Feed they stay inside
it; `k` steps back and Escape returns. Below 760px the label wraps above the
title and the outline is hidden.

## The bloom

The one menu: a pink shape in the bottom-right corner, opened by pressing it or
`.`, and by `/` straight into search. Its four lobes merge through an SVG goo
filter and grow into four arms around the centre of the screen while the page
dims:

| Arm | Digest | Feed | Reader View |
| --- | --- | --- | --- |
| Go (north) | Digest, Feeds, Library, Settings, then every Feed by Rhythm | same | same |
| Search (east) | Search line | Search line, Refresh now, Open the home page | Search line, Save to Library, Open the Original webpage, Open the Discussion, Copy link |
| Time (south) | Days, a 5-week calendar | Cadence, a 5-week calendar | Next in the Digest |
| View (west) | Firehose: Fold or Lane; Theme | Theme | Text size, Reading Source, Theme |

Arrow keys from the core move into an arm. Below 700px the bloom opens as four
labelled lobes; the one chosen grows into its arm while the opposite folds
away. Under `prefers-reduced-motion` it opens and closes without motion.

## Not built from the prototype

- **Columns and Wall layouts, and the Images choice.** Only the Index layout is
  ported; the Digest serves no image the other layouts were drawn around.
- **Live filtering from the search line.** The line submits to the v2 Search
  results, which search the whole installation by Search Scope.
- **The prototype's disabled actions** — Add a Feed, Import and Export OPML,
  Check all Feeds, editing a Feed, Unsubscribe. They stay on the v2 Feeds and
  Feed screens.
