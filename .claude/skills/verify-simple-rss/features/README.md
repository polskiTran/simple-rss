# simple-rss UI verification map

This directory is the maintained source for verifying what a reader sees. Read the index, then use the matching file as the recipe.

## Baseline preconditions

- `verify.mjs up` has printed `ready`, and `verify.mjs doctor` exits 0.
- Screens come from the dev mock's `worst` dataset unless the recipe says otherwise.
- Search comes from `SEARCH_ANSWER` in `verify.mjs`, because the mock does not answer it.
- Specs boot their own service. They never need `up`, and they run against `dist/client`.
- Never drive an instance this run did not start. 5173 and 8080 are the developer's.

## Driving conventions

- `verify` below means `node .claude/skills/verify-simple-rss/scripts/verify.mjs`.
- `spec` below means `pnpm exec playwright test --workers=1`, after `pnpm build:client`.
- Prefer ARIA roles and accessible names. Classes appear here only for measured layout.
- Treat every command as literal.
- Use the words in `CONTEXT.md`: Feed, Digest, Subscription, Quiet Spell, Cadence.

## Proof and skip reporting

- Sweep proof is the tag's `metrics.json` plus screenshots you have looked at.
- Path proof is the spec's pass line in its log.
- Report an unreachable path with the command tried and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behaviour. It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify and spec`, `Gotchas`.

## Features

- [Page titles](./page-titles.md) covers the one title style and the line it sits on across screens.
- [Digest box](./digest-box.md) covers a Feed's day, folding, the quiet tag and opening the Reader.
- [Saved highlight](./saved-highlight.md) covers saving from a list and how a saved title reads.
- [Search results](./search-results.md) covers Feed rows, matches and Narrow by feed.
- [Feeds list](./feeds-list.md) covers Feed rows, Cadence strips and rhythm groups.
