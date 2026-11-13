# Page titles

Every screen's title and every Digest day share one style, and on desktop they sit on one line, so nothing jumps when a reader changes screens.

## Sub-features

- `title-style` sets every title at 48/500, 36 on a phone.
- `title-line` keeps Digest, Feeds, Saved, Settings and Search on one line.
- `title-count` shows a count as a bare grey number beside the title; a Digest day's sits in parentheses, so it never reads as a year.
- `title-distance` shows how far back a day is on a line above its date.

## How to get to it (user POV)

- Choose Digest, Feeds or Saved in the header.
- Search for anything from the search field.
- Choose Settings in the header.

## Driving it with verify and spec

Preconditions:

- The baseline holds, with no `--param` left over from a prototype.

- **Line and style.** Sweep the screens. Run `verify sweep --tag titles --screens digest,feeds,saved,settings,search`. No `title differs` finding appears, and each target's `title` values in `metrics.json` match exactly.
- **Real path.** Run `spec tests/browser/digest.spec.ts -g "sets the date on the line"`. It passes against a real Digest.
- **Long names.** Look at `titles/p390/digest.png` and `titles/p320/digest.png`. The date shows as `Thu 22 Oct`; at 390 it and its count share a line, at 320 the count may take its own.
- **Proof.** Keep the tag's `metrics.json` and the screenshots of the screens you changed.

## Gotchas

- The Feed page sits lower because of its Back button. It is left out of the line check on purpose.
- A phone's Digest date sits 25px lower. Its 24px padding has no room for the distance, so the check leaves it out.
- Sign in and Setup also use the title. The mock is always signed in, so route `/api/auth/status` in a spec to see them.
