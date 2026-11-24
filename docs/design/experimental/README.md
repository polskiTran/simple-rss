# Experimental interface

The experimental interface is chosen per device in Settings under Interface
(ADR 0032). It draws every screen: sign-in and setup, the Digest, Feeds, a
Feed, the Library, the Reader View, Search results and Settings. `index.html`
is the prototype
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
- **Controls.** Choices are words in a row, the chosen one in ink and the rest
  grey; actions are ink words 24px apart; fields sit on the page tone. A
  screen's options and actions are rows of its own ledger, never a menu.
- **Surfaces.** No hairlines, borders, radii or shadows. Separation is space
  and tone: `--x-tone` under a hovered or focused row, and an unfolded fold.
- **Colour.** OKLCH, greyscale paper and ink, warm hue 95. Colour appears only
  in data: a Feed's name and Cadence take its Rhythm's colour — Firehose
  `oklch(0.63 0.19 35)`, Daily `oklch(0.78 0.14 82)`, Weekly
  `oklch(0.62 0.12 150)`, Monthly `oklch(0.52 0.08 250)`, Inactive grey — with
  lightness capped at 0.62 on light paper so Daily stays legible. Saved is the
  pink: a saved row sits on a pink wash and shows the word Saved beside its
  time, and selected text takes the same pink. Dark follows Appearance through `light-dark()`.

## Sign-in and setup

Before the access gate opens there is no top bar, only a ledger under the name
simple: Sign in, with a Password line; or Set up simple, with Setup secret,
Password and Confirm password lines and the reason it is needed. Each line has
a grey Show beside it. A refused line says why under itself and takes focus;
anything else is said beside the submit word. While simple is opening the
ledger says so, and when its server does not answer it says which way, with
Retry.

## Top bar

One row at the top of every screen: the places (Digest, Library, Feeds) in the
label columns, the current one in weight 500; the search line in the main
columns; and Settings at the end. The search line's prompt names its Search
Scope and it submits to Search results; `/` focuses it. Below 760px the
places and Settings share the first line and the search line follows.

## Digest

The ledger is three rows: Layout, Index, Columns or Wall (kept per device);
Firehose, Fold or Lane; and Day, the day shown, which opens a 5-week calendar
to pick another. Above them a line appears only when there is nothing to show:
no Feeds yet, with Add a Feed; nothing on or before the day; or the Digest
failing to load, with Retry.

In the Index layout, days follow as rows: title, Feed, time, with Save
revealed on hover or keyboard focus. The end of a Quiet Spell, which v2 notes
at the top of its day, is not shown. A sticky legend at the bottom names the
columns. Show older days pages by whole days (ADR 0011).

The two other layouts set each day's Feed Items as cards: the Feed Item's
image when it has one (proxied, ADR 0018; capped in height and cropped), the
title, the Feed and time with Save, and up to four lines of summary. A saved
card sits on the pink wash. A Firehose fold is a card too: the count, the Feed
and span of times, and the latest title, or every title once unfolded.

- **Columns.** Cards flow down up to four columns, at least 200px wide.
- **Wall.** Cards hang from a shared bottom line on twelve columns, placed in
  a cycle of four row patterns that starts at the day of the month, so
  neighbouring days start on different patterns. Images are capped at 72% of the window height.

Below 760px both become one column. Under Lane, the cards narrow to make room
for the Lane as the rows do. The legend shows only for Index.

A Firehose Feed is treated one of two ways, chosen in the Firehose row and kept
per device:

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

Under the Feed's name, a row of actions: Refresh now, Edit name and
description, Unsubscribe. Edit replaces the row with a Name line and a
Description field on the page tone; an empty line falls back to what the Feed
reports, shown as the placeholder. Save changes stays grey until something
changed; Escape or Cancel leaves the form. Unsubscribe adds a line saying what
it does and a second press, which unsubscribes and returns to Feeds.

## Feeds

The ledger counts the Subscriptions, then Add a Feed and Import. Add a Feed is
an address line: a pasted address is read at once, a typed one after a pause;
a site naming several Feeds lists them to choose from; the chosen Feed shows
its Rhythm, its last Feed Item and its newest titles above Subscribe, which
opens the new Feed. Import an OPML file reports what it added. With no Feeds
yet, the address line takes focus; the empty Digest's Add a Feed leads here.
The Feeds follow grouped by Rhythm, each row the name, the site and its Feed
Items over the last 30 days.

## Library

The ledger row names the Library, counts the saved Feed Items and names the
order. Rows group by the month saved, or by Feed when ordered By Feed (chosen
in the Order row, kept on the history entry). A row gives the title, the
Feed in its Rhythm colour (grey with a tooltip once unsubscribed) and the day
saved. Nothing carries the pink wash, since everything here is saved: Saved
shows on hover or focus, and pressing it greys the row and leaves Save showing
so the change can be undone.

## Reader View

The wall label on the left: the way back, the Feed, the day and time, reading
time; then Save, the Discussion, Open the Original webpage and Copy link; then
the Reading Source and Text size as choices; and how far read. The
title and body in the main columns, at most 66ch. With three or more headings,
an outline on the right follows the reading position. Next is pinned to the
bottom edge in the Digest's columns. Next and `j` follow the Digest's folding:
from a quiet Feed they skip the Firehose, from a Firehose Feed they stay inside
it; `k` steps back and Escape returns. Below 760px the label wraps above the
title and the outline is hidden.

## Search results

The ledger quotes the search and counts what matched, then In, when the search
has a Search Scope to leave (the scope's name or Everywhere), and Order, Best
match or Newest (not for a search of Feeds). A Feed gone from the
Subscriptions says so and offers Search everywhere.

Feeds whose names match come first, as the Feeds screen's rows. Matching Feed
Items follow grouped by Feed, the groups in the order their best result
ranks: the label column names the Feed in its Rhythm colour, counts its
matches and, in a search of everything, offers Search only here, which
narrows the search to that Feed.
Each row gives the title and up to two lines of snippet, with matched words on
the deeper tone, and the day and time, with Save revealed on hover or focus.
A three-way choice of layouts (a ledger in the Digest's columns, this one, and
a concordance aligned on the matched word) was prototyped and this one kept.

## Settings

One ledger: Theme, Interface (v2 or Experimental, which switches at once),
Timezone, Export (OPML or everything as JSON), Account (Change password, which
opens its three lines in the row, and Sign out) and the version.

## Not built from the prototype

- **The Images choice.** Columns and Wall always show a Feed Item's image
  when it has one.
- **Live filtering from the search line.** The line submits to Search
  results, which search the whole installation by Search Scope.
- **Check all Feeds.** Only the v2 Feeds screen has it.
