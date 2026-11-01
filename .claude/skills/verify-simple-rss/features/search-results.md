# Search results

A search leads with matching Feeds as rows, then items with the words marked, and Narrow by feed beside them.

## Sub-features

- `search-feeds` shows matching Subscriptions as Feed rows, up to five.
- `search-width` gives a Feed's name its width beside Narrow by feed.
- `search-marks` marks the query's words in titles and snippets.
- `search-narrow` narrows the list to ticked Feeds, as chips on a phone.
- `search-scope` switches between a scope and Everywhere.

## How to get to it (user POV)

- Type in the search field on any screen.
- Press `/` outside a field, then type.
- On a phone, press the search square.

## Driving it with verify and spec

Preconditions:

- The baseline holds. `verify` answers search from `SEARCH_ANSWER`.

- **Render.** Run `verify sweep --tag search --screens search`. No findings at any target.
- **Width.** Run `spec tests/browser/search.spec.ts -g "gives a matching Feed"`. It passes at 1280px and 320px.
- **Jump.** Run `spec tests/browser/search.spec.ts -g "offers a matching Subscription"`. It opens the Feed.
- **Marks.** Run `spec tests/browser/search.spec.ts -g "shows the matched summary"`. It passes.
- **Proof.** Look at `search/d1180/search.png` and `search/p320/search.png`, and keep the spec log.

## Gotchas

- `SEARCH_ANSWER` is fixed, so the query word does not change the screen. Only a spec proves a real match.
- Narrow by feed needs results from two Feeds. Without it the list spans the page and rows go to two columns.
- Search results update after a pause. Wait for a result, not a fixed sleep.
- The same Feed row appears on the Feeds list, so sweep both after changing it.
