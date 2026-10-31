# simple — design system

Screens are drawn in `docs/design/v2/`: `desktop/`, `phone/`, `dialogs/` and
`dark/`. This document is what the stylesheet follows when a drawing and the
text disagree. Interactive behavior — focus, keyboard, trapping, dismissal —
comes from Base UI (ADR 0008); why this system replaced the first one is ADR
0010.

## 1. Principles

1. **Colour comes from the content.** The interface is greyscale. Colour
   appears only in data — Cadence, saved state and search matches — on a
   Feed's host, the one link that leaves for the publisher, and on the Feed
   name an item box links to. It is blue in light mode and yellow in dark.
2. **One shape means you can press it.** Every control is a hard-edged block of
   the same height. Grey fill is an ordinary action, ink fill is the single
   primary action on a screen. Counts and status are plain grey text with no
   box. The only text that acts on its own is a link, and links are underlined —
   except a Feed's host and an item's Feed name, which are coloured instead.
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

`ink-2` is the quietest grey for small text — meta, counts, placeholders — and
clears 4.5:1 on `control` as well as `ground`, so a placeholder in a field stays
readable. A grey control darkens under the pointer and when pressed, past where
`ink-2` holds, so text that stays grey inside a control — a chip's or a jump
button's count, an unselected segment — is `ink-off`, which clears 4.5:1 on
every control fill: `control`, `control-hover`, `toggle-off` and a selected
segment. On `ground`, `ink-3` clears only 3:1, so it is text only where that is enough:
the page title's companion value, disabled controls and separator dots. On a
selected filter's `ink` fill it clears 4.5:1 and carries that filter's count.
The lowest step with items, `ramp-2`, is 3:1 against `ground`, so a day with
one item never reads as empty. A day's number on the Digest month clears 4.5:1 on its
fill: `ink` up to `ramp-2`, `ground` from `ramp-3`, in both modes. Days of the
months either side are plain `ink-3` numbers, as a day with nothing is — they
are picked in their own month. `tests/client/design-foundation.test.ts` holds
every ratio this section promises against the tokens.

Under forced colours the fills and rings that mark a choice drop out, so a
selected segment, the current section and a pressed chip take the system's
`Highlight` instead, and a focused field its outline.

### Light

| Token | Value | Use |
| --- | --- | --- |
| `ground` | `oklch(100% 0 0)` | page, dialog panel, selected segment |
| `ink` | `oklch(17.8% 0 0)` | text, primary button fill |
| `ink-2` | `oklch(52.5% 0 0)` | meta, secondary text, counts, placeholders |
| `ink-3` | `oklch(62% 0 0)` | title companion values, disabled text, separators |
| `ink-off` | `oklch(47.5% 0 0)` | grey text inside a control: unselected segments, chip and button counts |
| `control` | `oklch(95.2% 0 0)` | grey buttons, fields, switch tracks |
| `control-hover` | `oklch(91.9% 0 0)` | |
| `primary-hover` | `oklch(32% 0 0)` | primary button under the pointer |
| `row-hover` | `oklch(97.6% 0 0)` | list rows, undo line |
| `toggle-off` | `oklch(87.6% 0 0)` | toggle track when off, a grey control pressed |
| `rule` | ink at `.14` | under group headings |
| `rule-soft` | ink at `.07` | between rows |
| `edge` / `edge-hover` | ink at `.12` / `.5` | item boxes |
| `danger` / `danger-fill` | `oklch(50% 0.182 29.5)` / `oklch(94.8% 0.02 25.2)` | Unsubscribe, errors |
| `ramp-1…5` | `oklch(95.7% 0.015 277.9)` · `oklch(67.2% 0.11 277.5)` · `oklch(57% 0.153 274.2)` · `oklch(51.4% 0.197 270.9)` · `oklch(43.3% 0.24 267.6)` | Cadence, low to high |
| `saved` / `saved-edge` | `ramp-5` / `ramp-3` | saved icon, saved item edge |
| `away` | `ramp-5` | a Feed's host, wherever it is shown |
| `feed-name` | `ramp-4` | the Feed name an item box links to |
| `match` | `oklch(91.4% 0.032 277.9)` | search highlight and selected text, under `ink` |
| `scrim` | ink at `.24` | behind a dialog |

### Dark

| Token | Value |
| --- | --- |
| `ground` | `oklch(18.2% 0 0)` |
| `ink` | `oklch(94.6% 0 0)`; a primary button's text is `ground` |
| `ink-2` / `ink-3` | `oklch(68.6% 0 0)` / `oklch(53% 0 0)` |
| `ink-off` | `oklch(72% 0 0)` |
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
| `feed-name` | `ramp-4` |
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
- On desktop a 300px column beside a list — the Digest's month, a Feed filter —
  stands 64px from it, holds 24px from the top as the list scrolls, and scrolls
  itself when taller than the window. Without one, a list runs the page's full
  width.
- One breakpoint: `max-width: 1024px` is the phone layout. It keeps a
  phone's column, 560px at most and centred like the phone sheet, so a
  narrowed window or a tablet never stretches it. Below 375px the phone's top
  bar drops its mark to keep every square whole.
- A row that scrolls sideways fades over its trailing 32px, so what is past
  the edge reads as there: a day's Feed chips at every width, and on a phone
  the jump buttons and a Feed filter's chips.

## 5. Components

**Header (desktop, 68px).** Mark and wordmark; Digest / Feeds as a switch of
links; on the right, the search field (340px), then Saved and Settings as grey
buttons with their icons. Saved or Settings shows it is the current screen
with a 1px ink ring instead of a fill. Focus moves through it in the order it
shows: mark, switch, search, Saved, Settings. The header scrolls with the page.

**Phone chrome.** One 60px top bar that scrolls with the page, and nothing
fixed to the bottom edge: the mark without its wordmark, the Digest / Feeds
switch, then 44px squares for search, Saved and Settings, the current one
ringed in ink. Narrower than 375px the mark gives way — the Digest segment
goes home as well — and no square shrinks or slides under another. An opened Feed swaps the mark and the switch for a back square.
The Reader keeps only the back square, the search square and its toolbar —
Open original and Save, and Discussion when the Feed declares one, where Saved
and Settings stand — so one row holds it
whole and is focused in the order it is drawn; a search hides the sections
too. Pressing the search square turns the bar into the search field
with a back square.

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
Icons are Lucide's, at 16px from its 24px grid at a 2 stroke, with square caps
and mitred joins.
Primary: ink fill, ground text; one per screen. Destructive: grey fill, danger
text. Disabled: `control` fill with `ink-3` text. A control that is busy
keeps focus (`focusableWhenDisabled`), says what it is doing — Refreshing…,
Saving… — and keeps its own colours (`aria-busy`), since that label must stay
readable; only a control with nothing to do greys out. Icon-only: square, same height, with an accessible name. A select is
a grey button with a trailing chevron, as wide as its chosen value. Pressed, a
grey control fills with `toggle-off`, a destructive one with `danger-fill`, and
the primary one steps a further 12% from ink toward `ground`; nothing moves.

**Switch.** A grey track with 3px padding and 2px gaps; the selected segment
is `ground` with a hairline ring, the rest are `ink-off` and darken on hover.
Used for sections, views and settings with two or three values. Arrow keys
move within it. On a phone a screen's switch spans the column, its segments
sharing the width, padded 4px at least so three fit the narrowest screen.

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
the meta column narrows to 56px for the time. The meta column sits on the
title's first baseline, and the save square centres on its first line, however
many lines the title runs to. A title or snippet holds a measure of 32em —
about 66 characters a line — so a box as wide as the page keeps its edges with
the page's and its lines short enough to read. The save square shows on hover
and focus; a saved item shows it always, filled in `saved`, and keeps a
`saved-edge` border that deepens to `ramp-4` on hover — except on Saved, where
every item is saved and the edge would say nothing. On a phone the Feed name
and time share one line above the title and the save square is always visible
at 44px — except in the Digest, which saves from the Reader alone. The whole box opens the Reader; the Feed name inside it opens the
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
and 2px on a phone, the cells narrowing to fill the panel edge to edge where it
is too narrow for 11), month labels under it and a Fewer → More legend in 10px
squares — on a phone, squares the size of the cells. A day with items is a
button that scrolls to that day's items.

**Group.** A group heading with its count in `ink-2`, a `rule` under it on
panels, then its content. A count is always the whole group's: the Digest's
come from the server; elsewhere a count appears only once the group is loaded.

**Dialog.** A 560px ground panel with a hairline ring and a soft shadow over
the `scrim`, 140px from the top. Title 20/500 with a close square; the footer
is right-aligned Cancel and the primary action, which stays disabled until
there is something to submit. On a phone it is a hard-edged sheet, still at most
560px wide and centred, rising from the bottom edge with Cancel and the primary action side by side at 48px;
a sheet taller than the screen scrolls, and scrolls back to its title. The
scrim and the desktop panel fade in over 150ms and out over 120ms; the sheet
rises in over 240ms and sinks out over 180ms, opaque, under the fading scrim.
While one is open the page's scrollbar gutter takes the scrim's colour too,
fading with it both ways, so no strip runs down the edge.

**Add feed.** A dialog with a switch of Site or feed URL and Import OPML. The
address field stays put and what the address answers arrives under it: a paste
or Enter looks it up at once, typing once it pauses, and "Reading
publisher.example" is the wait. A lone Feed stands under a rule, not in a box:
its name and Cadence strip, a meta line — Last item 3 days ago · Weekly — its
five newest titles in Literata 16, two lines at most, each with its day in
meta, then the Feed's address. A page naming several says so — "publisher.example
names 3 feeds" — and gives each a box with its name, strip and
meta line. The first is chosen, ringed in ink with no radio mark, and only the
chosen box opens to its titles; arrow keys move the choice. A Feed with no item
in 90 days says Last item 2 years ago in ink at 500. One already followed says You follow
this, and the primary action reads Already subscribed, disabled. A page that
names no Feed, or an address that doesn't answer, is a field error with its
reason; the second ends "Nothing was added." and turns the primary action to
Retry. Subscribe is the one primary action, and its new row simply arrives in
the list. No field carries a note: the switch names both kinds of address, and
the Import tab's only line under its file is a refusal.

**Undo line.** Removing something from a list leaves a `row-hover` line in
its place saying what happened, with an outlined Undo button, so the list does
not jump.

**Digest.** Today's short date as the title's companion, then one list, newest
day first, each day a group headed with its count; the date is said once, in
the title's companion or the heading itself. Under the heading the day's Feeds
stand as chips with their counts, in one row that scrolls sideways at every width; a pressed chip, ringed in ink, shows that Feed's box
alone, and pressing it again shows them all. Each Feed that published that day
gets one box, the most recent first: a lone item is the ordinary item box; more
share a box, the Feed's name and its count in the meta column and each title
on its own line with its time. Past 5 items the box shows
the newest 3 and Show N more, which turns to Show less once pressed. A Feed
back after a week or more without items says so under its time — its last 14
days of Cadence, then First item in 12 days. The list starts today, or from a
day picked on the month — that day and everything before it — and then Back to
today stands at its head, as Show more stands at its foot; the address keeps
the day, so the way back from an article returns to it. Beside the list, a
month of the whole Digest: its name with turns to the months before and after,
the days Monday first, each shaded by its count against the calendar's other
days and those of the months either side plain, the day on show ringed, then the legend. Any day
with items starts the list there. The Digest reads one way only: what a single
Feed has published lately is that Feed's own screen. On a phone a calendar
button at the end of the title's row opens the platform's own date picker, in
place of the month, and a day's chips run past the screen's edge. The phone Digest has no
save squares and no entry times, so a title uses the width of the box. A lone
title and a shared title each run three lines at most. A saved title in a
shared box keeps its bookmark, in `saved`, on the first line, clear of the
text. A lone box keeps its `saved-edge`. Pages are whole days,
as many as reach fifty items, so Show more continues from the next day and
names no number; Saved ends the same way. Before the first Subscription, the
Digest is "No feeds yet." and Add feed as the primary action, with no chips and no
month; with Subscriptions but nothing yet, it is "Nothing yet." The drawn Stream / By source switch is left out.

**Feeds list.** Subscriptions grouped by Rhythm under panel headings, six
rows to a group, then Show N more; opened,
Show fewer folds it back. With no Subscriptions there is nothing to export,
so Export OPML gives way to Add feed alone. Jump buttons
with each Rhythm's count reach the groups; By name lists everything
alphabetically instead, and Recently added newest Subscription first. A row says when an imported Feed awaits its first check, or why
checking fails and when it last reached the Feed, with Retry.

**One Feed.** The way back, then the Feed's name, description and host (as in
a Feed row) with Edit, Refresh now and Unsubscribe beside them on the title's
first line — under them on a phone, wrapping to fill each line — then three panels: Cadence (the
grid), Info (subscribed, items in 26 weeks, busiest day, longest quiet
stretch, last checked) and Settings (Check every, Open items with). Cadence and Settings
keep their own widths and Info takes the rest; where the three do not fit on one line,
Settings wraps under Cadence. Items follow, grouped by
day with whole counts.

**Reader.** A toolbar — the way back on the left, Open original ↗, Discussion and
Save on the right — over a 680px column: the title, a meta line of the Feed (a
link), the day and the minutes to read, the Reading Source switch
(spanning the column on a phone), then the article.
The Discussion appears only when the Feed declares one. It is a grey button in
that toolbar, labelled Discussion beside a chat bubble, and on a phone the same
square as Open original and Save, the bubble alone, named Discussion. It opens
in a new tab because it leaves for another site.
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
Subscriptions lead as Feed rows, a lone one spanning the list; items follow
with the query's words marked in `match`. Beside them, Narrow by feed lists the
Feeds the results came from, with counts, and narrows the list to those ticked —
a checkbox list on desktop, a row of chips on a phone.

**Gate.** Setup and Sign in are the screens before the reader. Their submit
is never disabled before it is pressed: a reason that belongs to one field —
empty, wrong, too short, not the same — is that field's error and takes focus.
Before either, while nothing has said whether this device may read, the page
says why — Can't reach simple, or simple isn't available — with Retry, and asks
again on its own when the connection or the tab comes back and on a wait that
doubles up to a minute.

**Notices.** A result the User waits on outside a dialog — an import, a
refresh — is one line of meta text in an `aria-live` region under the control
that started it. Errors give a reason, in danger text, never an apology. A
failed save is the exception: rows and toolbars have no room and the toggle may
have left the screen, so one dismissible line sticks to the top of the page.

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
| Search saved posts | Search your saves |
| By source | By feed |

Rhythm is shown as **Daily**, **Weekly**, **Monthly** and **Inactive** (no
items in 30 days). Say what happened: "The feed can't be reached. Last reached
7 Sep." Errors give a reason: "That password isn't right. Passwords are
case-sensitive."

No taglines, helper notes or secondary labels. A heading, a value or a button
names itself; a sentence that explains a control, repeats a value shown
elsewhere on the screen, or tells the User to press the button beside it is
cut, and if the screen does not make sense without it, its layout changes
instead. What stays is a reason (an error), a consequence the User cannot see
before acting (a dialog's description: Change password signs out every device;
Unsubscribe keeps saves), or a state the screen cannot show otherwise ("Feed
content for now", "Shortened by simple."). A control that changed shows its
new value itself; no notice repeats it. The gate keeps its own words: Setup and
Sign in their tagline, Can't reach simple its note, and Settings a note under
each preference.

## 7. Motion

Screens and lists are instant. What the User presses or opens — a control, a
switch, a screen with its title and toolbar, a hover, a jump within a page —
changes in the same frame, and nothing moves: a pressed control steps its fill,
never its size. The lists read many times a day — item boxes, Feed rows and
cards, group headings, a title's companion value, a Feed's panels — appear
without a fade.
An item box steps to `row-hover` while pressed. Hover styles apply only where a
pointer can hover, so a tap never leaves one behind.
What answers an action — what an address answers in Add feed, the undo line an
unsave leaves, the notice or error an action answers with — fades in over 150ms
as it mounts, opacity only. So does an article, and the Original webpage arriving
over Feed Content is a new article that fades in, never text rewritten in
place. A wait shorter than 400ms shows nothing; after that the waiting line
fades in.
Stepping to another day keeps the one on show until the next answers, so the
screen changes once rather than emptying first.

A change of Appearance crossfades the screen over 200ms, the one press that is
not answered in the same frame.

On Sign in and Setup the mark assembles along its diagonal, once, without
holding up the form.

A dialog is the one thing with an exit (see Dialog). Under
`prefers-reduced-motion` there is less motion, not none: fades stay, nothing
moves — the sheet fades in place instead of rising, and the waiting tile and the
mark hold still.

## 8. Not yet designed

Drawn but waiting on the API: Show in digest and a Feed's editable URL. Not drawn: empty states beyond the Digest's
first run, confirmations after adding or importing, the reader fallback, offline, and the
dark versions of most screens — these follow the components above.
