# Saved highlight

A saved title is highlighted in every list except Saved itself. On hover or keyboard focus, Save or Saved appears over the end of the title's first line.

## Sub-features

- `saved-sweep` sweeps the highlight across a title's lines as it saves, and back.
- `saved-reveal` shows the word on hover and keyboard focus only.
- `saved-release` lets the word go once the pointer leaves a clicked row.
- `saved-name` names a saved title as saved to a screen reader.
- `saved-none` shows no highlight on Saved or a search of it.

## How to get to it (user POV)

- Hover a title in the Digest, a Feed's page or Search, and choose Save.
- Tab to a title and on to its Save word.
- Open Saved in the header.

## Driving it with verify and spec

Preconditions:

- The baseline holds. Saving paths boot their own service, because a save is a real write.

- **Save and persist.** Run `spec tests/browser/library.spec.ts -g "saves from the Digest"`. It passes across a reload.
- **Release.** Run `spec tests/browser/library.spec.ts -g "lets Save go once the pointer leaves"`. It passes for pointer and keyboard.
- **Keyboard.** Run `spec tests/browser/library.spec.ts -g "save is keyboard-operable"`. It passes.
- **Render.** Run `verify sweep --tag saved --screens digest,saved,feed --targets d1180,p390`. No findings, and the mock's saved titles read as highlighted outside Saved.
- **Proof.** Keep the spec log and look at the highlight in dark on `d1025`.

## Gotchas

- `verify` cannot prove a save. The mock's write is not stored, so only a spec counts.
- A mouse click also focuses the button, so `:focus-within` keeps the word visible. Use `:focus-visible`.
- Touch screens have no hover. On a phone the word sits on the meta line, and the Digest has none.
