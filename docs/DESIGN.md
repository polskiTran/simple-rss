# simple — design system

Screens are drawn in `docs/design/v2/`: `desktop/`, `phone/`, `dialogs/` and
`dark/`. This document is what the stylesheet follows when a drawing and the
text disagree. Interactive behavior — focus, keyboard, trapping, dismissal —
comes from Base UI (ADR 0008); why this system replaced the first one is ADR
0010.

## 1. Principles

1. **Colour comes from the content.** The interface is greyscale. Colour
   appears only in data — Cadence, saved state and search matches — and on a
   Feed's host, the one link that leaves for the publisher. It is blue in light
   mode and yellow in dark.
2. **One shape means you can press it.** Every control is a hard-edged block of
   the same height. Grey fill is an ordinary action, ink fill is the single
   primary action on a screen. Counts and status are plain grey text with no
   box. The only text that acts on its own is a link, and links are underlined —
   except a Feed's host, which is coloured instead.
3. **Hierarchy from size and weight.** No cards, shadows, tinted bars or
   coloured headers. Hairlines separate groups; thin-edged boxes hold items and
   Feeds.
4. **Say what happens.** Labels are sentence case and name the result: Add
   feed, Export OPML, Show 16 more, Retry, Unsubscribe.
5. **Type split by job.** Literata for what you read, Instrument Sans for what
   you operate.

Never: rounded corners, coloured menu bars, cream paper, mono small caps, ALL
CAPS, decoration without a source in the data.

## 2. Colour

Tokens are OKLCH. Ink rules are the ink at an alpha, so they sit correctly on
any ground.

`ink-2` is the quietest grey for small text — meta, counts, placeholders. On
`ground`, `ink-3` clears only 3:1, so it is text only where that is enough:
the page title's companion value, disabled controls and separator dots. On a
selected filter's `ink` fill it clears 4.5:1 and carries that filter's count.
The lowest step with items, `ramp-2`, is 3:1 against `ground`, so a day with
one item never reads as empty.

### Light

| Token | Value | Use |
| --- | --- | --- |
| `ground` | `oklch(100% 0 0)` | page, dialog panel, selected segment |
| `ink` | `oklch(17.8% 0 0)` | text, primary button fill |
| `ink-2` | `oklch(53.8% 0 0)` | meta, secondary text, counts, placeholders |
| `ink-3` | `oklch(62% 0 0)` | title companion values, disabled text, separators |
| `ink-off` | `oklch(47.5% 0 0)` | unselected segment text |
| `control` | `oklch(95.2% 0 0)` | grey buttons, fields, switch tracks |
| `control-hover` | `oklch(91.9% 0 0)` | |
| `primary-hover` | `oklch(32% 0 0)` | primary button under the pointer |
| `row-hover` | `oklch(97.6% 0 0)` | list rows, undo line |
| `toggle-off` | `oklch(87.6% 0 0)` | toggle track when off, a grey control pressed |
| `rule` | ink at `.14` | under group headings |
| `rule-soft` | ink at `.07` | between rows |
| `edge` / `edge-hover` | ink at `.12` / `.5` | item boxes |
| `danger` / `danger-fill` | `oklch(50% 0.182 29.5)` / `oklch(94.8% 0.02 25.2)` | Unsubscribe, errors |
| `ramp-1…5` | `oklch(95.7% 0.015 277.9)` · `oklch(67.5% 0.11 277.5)` · `oklch(59.4% 0.153 274.2)` · `oklch(51.4% 0.197 270.9)` · `oklch(43.3% 0.24 267.6)` | Cadence, low to high |
| `saved` / `saved-edge` | `ramp-5` / `ramp-3` | saved icon, saved item edge |
| `away` | `ramp-5` | a Feed's host, wherever it is shown |
| `match` | `oklch(91.4% 0.032 277.9)` | search highlight, under `ink` text |
| `scrim` | ink at `.24` | behind a dialog |

### Dark

| Token | Value |
| --- | --- |
| `ground` | `oklch(18.2% 0 0)` |
| `ink` | `oklch(94.6% 0 0)`; a primary button's text is `ground` |
| `ink-2` / `ink-3` | `oklch(68.6% 0 0)` / `oklch(53% 0 0)` |
| `control` / `control-hover` | `oklch(26.9% 0 0)` / `oklch(30.9% 0 0)` |
| selected segment | `oklch(34.8% 0 0)` |
| `row-hover` | `oklch(22.6% 0 0)` |
| `primary-hover` | `oklch(84% 0 0)` |
| `scrim` | black at `.5` |
| rules and edges | `ink` at the light alphas |
| reader body | `oklch(88.8% 0 0)` |
| `danger` | `oklch(73.2% 0.164 27.1)` |
| `ramp-1…5` | `oklch(23.9% 0.023 96.7)` · `oklch(49% 0.08 97)` · `oklch(61.3% 0.106 96.1)` · `oklch(73.5% 0.132 95.2)` · `oklch(85.8% 0.158 94.4)` |
| `saved` / `saved-edge` | `ramp-5` / `ramp-3` |
| `away` | `ramp-5` |
| `match` | `oklch(37.5% 0.063 97.7)` |

Appearance follows the system unless the User picks Light or Dark in Settings;
the choice is per device.

## 3. Type

| Role | Face | Size / line-height | Weight |
| --- | --- | --- | --- |
| Page title | Instrument Sans | 40/1.08 desktop, 32/1.08 phone, −0.015em | 500; companion value in `ink-3` at 400; an unbroken name wraps anywhere |
| Group heading | Instrument Sans | 17/1 desktop, 16/1 phone | 500; count beside it in `ink-2` at 400 |
| Control label | Instrument Sans | 14/1 (13.5 in switches) | 500 |
| Meta, captions, notes | Instrument Sans | 13/1.45 | 400, `ink-2` |
| Item title in a list | Literata | 19/1.4 desktop, 17/1.38 phone | 400; three lines, then an ellipsis |
| Feed name | Literata | 19/1.2 | 400 |
| Feed card title | Literata | 24/1.2 | 400; the card's heading, a step above a Feed row's name |
| Feed Description | Literata | 17/1.5 | 400 |
| Reader title | Literata | 44/1.16 desktop, 30/1.18 phone | 400, `text-wrap: balance` |
| Reader body | Literata | 19/1.7 desktop, 17/1.65 phone | 400, reader-body colour |
| Wordmark | Literata italic | 21 desktop, 19 phone | 400 |

Numbers in counts and meta use tabular figures.

## 4. Space and size

- Desktop pages are 40px from the sides with content no wider than 1280px;
  content starts 56px below the header (32px on an opened Feed, which leads
  with a back button). The Reader's toolbar sits 32px below the header and its
  title 64px below that.
- Control height is 36px on desktop and 44px on a phone (48px for fields and
  sheet buttons). Small inline controls are 30px.
- Item boxes are 8px apart; groups 56px; the title row and its toolbar 28px.
- The reading column is 680px, centred.
- On desktop a 300px column beside a list — the Digest's days, a Feed filter —
  holds 24px from the top as the list scrolls, and scrolls itself when taller
  than the window.
- One breakpoint: `max-width: 640px` is the phone layout.
- A phone row that scrolls sideways — Rhythm chips, jump buttons, a Feed
  filter's chips — fades over its trailing 32px, so what is past the edge
  reads as there.

## 5. Components

**Header (desktop, 68px).** Mark and wordmark; Digest / Feeds / Saved as a
switch of links; on the right, the search field (340px) and a Settings button.
Settings shows it is the current screen with a 1px ink ring instead of a fill.
The header scrolls with the page.

**Phone chrome.** A 60px top bar: the mark on the left, a 44px search square
on the right. A nested screen — an opened Feed, the Reader — swaps the mark for
a back square, and the Reader sets Open original and Save as squares beside the
search square, so one row holds its whole toolbar. Pressing the search square
turns the bar into the search field with a back square. A bottom tab bar carries Digest, Feeds, Saved and Settings
as a 48px grey track whose current tab is a ground segment; the Reader, search
and dialogs hide it.

**Section.** Exactly one section is current, including in the Reader: it
borrows the section it was opened from — Saved for a save, Feeds for an item of
an opened Feed, the Digest otherwise and when opened by address. An opened Feed
is always Feeds. A search reads under its scope's section.

**Back button.** A grey button with a leading arrow, named after the screen it
returns to: Digest, Feeds, Saved, Article, Search, or the Feed's name. It is
the browser's Back when the screen was opened from there, so it lands on the
same entry, scrolled where it was left, and the browser's Back never reopens
what was just closed. A screen opened by address walks forward to its own
section instead.

**Arriving.** Every screen names itself in the tab — `Digest — simple`, the
Feed's name, the Feed Item's title — and on each navigation its heading takes
focus, so the change is announced; the first load leaves focus alone.

**Search field.** Grey, a magnifier before the words and a `/` key hint after
them; `/` anywhere outside a field focuses it. The placeholder names the Search
Scope taken from the screen: "Search your reading", "Search your saves",
"Search your feeds", "Search this feed". With words in it, the field turns
ground-coloured with a 1px ink ring and a clear button. Focused, it carries
the 2px focus outline every control does.

**Buttons.** Grey: `control`, ink text, 14/500, 14px side padding, an icon
before the label (after it for chevrons and the ↗ of a link that leaves).
Icons are 16px, drawn on a 24px grid at a 2 stroke with square caps.
Primary: ink fill, ground text; one per screen. Destructive: grey fill, danger
text. Disabled: `control` fill with `ink-3` text. A control that is busy
keeps focus (`focusableWhenDisabled`) and says what it is doing: Refreshing…,
Saving…. Icon-only: square, same height, with an accessible name. A select is
a grey button with a trailing chevron, as wide as its chosen value. Pressed, a
grey control fills with `toggle-off` and the primary one steps a further 12%
from ink toward `ground`; nothing moves.

**Switch.** A grey track with 3px padding and 2px gaps; the selected segment
is `ground` with a hairline ring, the rest are `ink-off` and darken on hover.
Used for sections, views and settings with two or three values. Arrow keys
move within it.

**Toggle.** 40×22 track with a 16px square knob; ink when on, `toggle-off`
when off.

**Checkbox.** 14px square (16px on a phone), 1px border; checked is ink with a
ground tick. The whole row is the hit target.

**Field.** Grey fill, no border, 40px (48px phone), label above in 14/500,
note below in meta. Focus: ground fill and a 1px ink ring. Error: ground fill,
a 1px danger ring, and the reason under it in danger.

**Item box.** A thin-edged box with 20px vertical padding. Desktop is a grid:
a 180px meta column (Feed name in 500, time or date under it in `ink-2`), then
the title, then a 36px save square; in a Feed's own list, which names no Feed,
the meta column narrows to 56px for the time. The save square shows on hover
and focus; a saved item shows it always, filled in `saved`, and keeps a
`saved-edge` border that deepens to `ramp-4` on hover — except on Saved, where
every item is saved and the edge would say nothing. On a phone the Feed name
and time share one line above the title and the save square is always visible
at 44px. The whole box opens the Reader; the Feed name inside it opens the
Feed. In search results a snippet sits under the title with the matched words
marked in `match`.

**Feed row.** A thin-edged box with 16px padding: Feed name in Literata 19 with
a Cadence strip on the right, and under it the Feed Home Page host in `away`,
marked ↗ and underlined on hover — meta text when the Feed names no site. The
host looks the same wherever a Feed is named; it opens a new tab, and its
accessible name says so. Rows
are two columns on desktop with 8px between them, one on a phone with 12px.

**Label and value rows.** Label left in `ink-2`, value right in ink, 40px
minimum height, `rule-soft` between. Used for a Feed's Info and Settings panels
and the Settings screen.

**Cadence strip.** 30 days of 5px squares with 2px gaps on desktop, 14 on a
phone. A day with no items is `ramp-1`; items step up the ramp.

**Cadence grid.** 26 weeks as columns of seven 13px cells with 4px gaps (11px
and 2px on a phone), month labels under it and a Fewer → More legend. A day
with items is a button that scrolls to that day's items.

**Group.** A group heading with its count in `ink-2`, a `rule` under it on
panels, then its content. A count is always the whole group's: the Digest's
come from the server; elsewhere a count appears only once the group is loaded.

**Dialog.** A 560px ground panel with a hairline ring and a soft shadow over
the `scrim`, 140px from the top. Title 20/500 with a close square; the footer
is right-aligned Cancel and the primary action, which stays disabled until
there is something to submit. On a phone it is a hard-edged sheet rising from
the bottom edge with Cancel and the primary action side by side at 48px. The
scrim and the desktop panel fade in over 150ms and out over 120ms; the sheet
rises in over 240ms and sinks out over 180ms, opaque, under the fading scrim.
While one is open the page's scrollbar gutter takes the scrim's colour too,
fading with it both ways, so no strip runs down the edge.

**Undo line.** Removing something from a list leaves a `row-hover` line in
its place saying what happened, with an outlined Undo button, so the list does
not jump.

**Digest.** Today's short date as the title's companion, then a switch of All
items, By day and By feed; the address keeps the choice, so the way back from
an article returns to it. All items groups by day, with a switch of Everything
and each Rhythm at the other end narrowing it to the Feeds of that Rhythm;
beside it, the last seven days with the whole Digest's count, each opening that
day. By day draws 26 weeks of the whole Digest as the Cadence grid with the day
on show ringed, and its facts beside it — the day, its items and Feeds, the 26
weeks' items and busiest weekday — over the day's items; previous, Today and
next step through days, never past today, and the Feeds that day narrow the
list when ticked, as in search. By feed is a card per Subscription, the most
recently published first: a Feed row with the last 14 days of Cadence, then
under a `rule-soft` line its three newest items, each dated as briefly as the
distance allows — 09:12, Yesterday, Thu, 21 Aug. On a phone the switch spans
the page, the Rhythms scroll as chips in ink with the chosen one a segment
ringed in ink, the day list and the facts give way, the stepper names the day
as plain text between its arrows, and the cards stack. A long list ends in
Show more, which loads the next page wherever it falls — the rest of a day or
days beyond it — so it names no number; Saved ends the same way. Before the
first Subscription, All items is a note and Add feed as the primary action,
with no Rhythms and no days beside it; with Subscriptions but nothing yet, the
note says items arrive as the Feeds publish.

**Feeds list.** Subscriptions grouped by Rhythm under panel headings, six
rows to a group, then Show N more with the rest named beside it; opened,
Show fewer folds it back. With no Subscriptions there is nothing to export,
so Export OPML gives way to Add feed alone. Jump buttons
with each Rhythm's count reach the groups; By name lists everything
alphabetically instead, and Recently added newest Subscription first. A row says when a Feed awaits its first check, or why
checking fails, what it last reached and that its items stay, with Retry.

**One Feed.** The way back, then the Feed's name, description and host (as in
a Feed row) with
Edit, Refresh now and Unsubscribe beside them, then three panels: Cadence (the
grid), Info (subscribed, items in 26 weeks, busiest day, longest quiet
stretch, last checked) and Settings (Check every, Open items with). Items follow, grouped by
day with whole counts.

**Reader.** A toolbar — the way back on the left, Open original ↗ and Save on
the right — over a 680px column: the title, a meta line of the Feed (a link),
the day and the minutes to read, the Reading Source switch (spanning the column
on a phone), then the article.
The meta line names the reading only when it is not the one chosen: "Feed
content for now" while the Original webpage loads or fails, or the one reading
an item has when the chosen one is missing. Article links are ink and
underlined; they all leave, so none carries ↗. Next in the digest closes the
article as an item box.

The reading is set by the stylesheet, not the renderer: headings in Literata at
1.42em, 1.2em and 1em (600), each with room above it; list markers hanging
outside the column; a quote behind a 1px ink rule; tables in Instrument Sans
14/1.45 between hairlines; code squared in a thin-edged box with no controls;
images inside a faint 1px inset line. Waiting and retrying say what is read —
"Reading the original webpage", then plain Retry.

**Saved.** The count of saves as the title's companion, then a switch of
Newest saved, Oldest saved and By feed. The save orders group by the month
of the save; By feed groups the same list under each Feed's name. Each item's
meta says when it was saved — Saved today, Saved yesterday, Saved 27 August —
and, for a save that outlived its Subscription, No longer subscribed.

**Search results.** The words as the title, the count as its companion — and
the Feed's name when scoped to one. A search begun in a scope (a Feed, Saved,
Feeds) shows a switch of that scope and Everywhere, moving both ways; Best
match and Newest sit at the other end wherever items answer. Matching
Subscriptions lead as Feed rows; items follow with the query's words marked in
`match`. Beside them, the Feeds the results came from, with counts, narrow the
list when ticked — a checkbox list on desktop, a row of chips on a phone.

**Notices.** A result the User waits on — a first check, an import, a
refresh — is one line of meta text in an `aria-live` region under the control
that started it. Errors give a reason, in danger text, never an apology.

**Mark.** A 4×4 tile of 4px squares with 2px gaps drawn in the Cadence ramp,
then the wordmark. The same tile, glinting, stands before every waiting line.

## 6. Words

Screen copy uses the terms in `CONTEXT.md`. Where the drawings say otherwise,
the shipped words are:

| Drawn | Shipped |
| --- | --- |
| Sources | Feeds |
| post, posts | item, items |
| Full article / Feed text | Original webpage / Feed content |
| Open posts as | Open items with |
| Activity | Cadence |
| Edit source | Edit feed |
| Sources that day | Feeds that day |
| Search saved posts | Search your saves |
| By source | By feed |

Rhythm is shown as **Daily**, **Weekly**, **Monthly** and **Inactive** (no
items in 30 days). Say what happened and what stays: "Not responding since
7 Sep. Its items stay in your digest." Errors give a reason: "That password
isn't right. Passwords are case-sensitive."

## 7. Motion

Chrome is instant; data arrives. What the User presses or opens — a control, a
switch, a screen with its title and toolbar, a hover — changes in the same
frame, and nothing moves: a pressed control steps its fill, never its size.
What the server sends — item boxes, Feed rows and cards, a group's heading, a
title's companion value, a Feed's panels — fades in over 150ms as it mounts,
opacity only; an article over 200ms, and the Original webpage arriving over
Feed Content is a new article that fades in, never text rewritten in place. A
wait shorter than 400ms shows nothing; after that the waiting line fades in.
Stepping to another day keeps the one on show until the next answers, so the
screen changes once rather than emptying first.

A dialog is the one thing with an exit (see Dialog). Under
`prefers-reduced-motion` there is less motion, not none: fades stay, nothing
moves — the sheet fades in place instead of rising, jumps scroll instantly, and
the waiting tile holds still.

## 8. Not yet designed

Drawn but waiting on the API: Show in digest and a Feed's editable URL. Not drawn: empty states beyond the Digest's
first run, confirmations after adding or importing, the reader fallback, offline, and the
dark versions of most screens — these follow the components above.
