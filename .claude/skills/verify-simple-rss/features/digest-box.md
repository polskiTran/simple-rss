# Digest box

Each Feed that published on a day gets one box: its name, then titles across the full width. Long days fold, and the control stays in reach while unfolded.

## Sub-features

- `box-who` names the Feed, ending in an ellipsis when long, with a count above one item.
- `box-fold` folds over five items to three, with Show all and Show less.
- `box-sticky` keeps the Feed's line and Show less in reach down a long list.
- `box-quiet` tags a Feed back from a Quiet Spell with First in 12 days.
- `box-open` opens the Reader from anywhere in a lone box.

## How to get to it (user POV)

- Open the app. The Digest is the first screen.
- Choose Digest in the header, or a day in the calendar.

## Driving it with verify and spec

Preconditions:

- The baseline holds. Fold paths boot their own service with forty items.

- **Render.** Run `verify sweep --tag digest --screens digest`. No findings for the screen.
- **Fold without moving.** Run `spec tests/browser/digest.spec.ts -g "folds from where it unfolded"`. It passes, so no title moves between states.
- **Open anywhere.** Run `spec tests/browser/digest.spec.ts -g "opens the Reader from anywhere"`. It passes.
- **Phone.** Run `spec tests/browser/digest.spec.ts -g "leaves saving to the Reader"`. It passes.
- **Proof.** Look at `digest/p390/digest.png` and `digest/p320/digest.png`, and keep the spec log.

## Gotchas

- A resting screenshot cannot show a jump. Measure title positions before and after the toggle.
- The `worst` dataset includes a very long URL title. A break inside an address is expected, and the sweep skips it.
- The Digest has no Save on a phone. Saving is in the Reader there, on purpose.
