# anti-slop (vendored)

Oxlint rules from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). Upstream ships no package; its `install-anti-slop` skill copies the plugin into a repository, and this directory is that copy. `oxlint.config.mjs` registers it and picks the rules.

## Upstream revision

[`6d53855`](https://github.com/dmmulroy/anti-slop/commit/6d538555cb151d4121ed51a27db81890eacf8ae9) (2026-08-18, "feat: add opt-in Effect lint rules"). Every file vendored here was byte-identical to `skills/install-anti-slop/assets/anti-slop/` (and `src/`) at that commit, and no other upstream revision matches all of them.

## Local changes

Deleted, because this repo does not use them:

- `effect/` — the opt-in Effect rules; this repo does not use Effect.
- `rules/no-conditional-empty-object-spread.ts` — conditional spreads are how this repo builds values with exact optional properties without mutating after construction.
- `rules/no-shape-in-symbol-names.ts` — tests use `shape` to name an intentionally malformed value.
- Their two entries in `index.ts`.

Added: this README, and `tsconfig.json`, which is upstream's root `tsconfig.json` with `include` pointed here. `pnpm typecheck` runs it; the repo's own `tsconfig.json` is stricter (`noUncheckedIndexedAccess`) than the code was written for.

No other file differs from upstream. Biome skips this directory so upstream's formatting stays and a diff against upstream stays readable.

## Updating

Diff the files here against the recorded revision's `skills/install-anti-slop/assets/anti-slop/`, take upstream's changes since then, reapply the deletions above, and record the new revision.
