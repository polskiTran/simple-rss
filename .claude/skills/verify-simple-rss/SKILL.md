---
name: verify-simple-rss
description: Drive the simple-rss web client in a real browser to prove UI work. Sweeps every screen across desktop, phone, 320px, 200% zoom and dark with worst-case data, measures overflow, broken words and title alignment, and captures screenshots. Use after any change to src/client, styles or docs/DESIGN.md, before saying UI work is done, when comparing prototype variants, or when asked to verify, check or prove a screen.
---

# Verify simple-rss

Two harnesses prove two different things. Use both for UI work.

| Harness | Proves | Backend |
| --- | --- | --- |
| `scripts/verify.mjs` | How every screen renders across widths and themes | The dev mock, never a real server |
| `tests/browser` (Playwright) | That a user path works: real claim, real SQLite, real clicks | A real service with fixture upstreams |

The sweep cannot prove behaviour. A spec cannot prove a screen looks right at 320px. Read [features/README.md](features/README.md), then the file for the feature you changed.

Paths below are from the repo root.

## Launch

```bash
node .claude/skills/verify-simple-rss/scripts/verify.mjs up
```

Starts a private Vite on `127.0.0.1:5199` with no proxy and its own dependency cache. Prints `ready` once a browser has rendered the Digest, about 3s warm and up to 60s cold. It needs no `.env`, no database and no server.

Never drive 5173 or 8080. Those are the developer's own `pnpm dev`, with their real Feeds and session. Vite's proxy forwards anything unmocked to 8080, which is why this instance has none.

## Doctor

```bash
node .claude/skills/verify-simple-rss/scripts/verify.mjs doctor
```

Read-only. Run it first, and again whenever a result looks wrong. It confirms the instance is ours, serves this checkout, cannot reach a real server, and has memory for a browser. It also prints the branch, commit and changed file count. Exit 1 means do not trust anything the instance tells you. Under 1GB free, stop and wait: other sessions share this machine, and browser runs fail with timeouts that look like app bugs.

## Drive

**Render sweep.** Each page loads the checkout's current code, so an edit needs no restart.

```bash
node .claude/skills/verify-simple-rss/scripts/verify.mjs sweep --tag <name>
```

| Flag | Values | Default |
| --- | --- | --- |
| `--tag` | Evidence folder name | `run` |
| `--targets` | `d1440`, `d1180`, `d1025` (dark), `p390`, `p320` (dark), `z200` (200% zoom) | all |
| `--screens` | `digest`, `feeds`, `saved`, `feed`, `settings`, `search` | all |
| `--data` | `worst`, `one`, `empty`, `huge` | `worst` |
| `--param` | A URL parameter such as `variant=A`, repeatable | none |
| `--browser` | `chromium`, `webkit` | `chromium` |
| `--rtl` | `true` mirrors the page | off |

`--browser webkit` needs `pnpm exec playwright install webkit` first. It is the nearest thing to Safari here, and `doctor` lists what is installed.

It exits 1 on any finding: sideways scrolling, an element past the screen edge, a word broken across lines, a page error, a mocked screen calling an unanswered API, or a title off the line other screens share. Numbers in `metrics.json` are raw. Never round them to compare.

**Before and after.** Capture before you edit, so you reproduce the problem with the data that shows it.

```bash
node .claude/skills/verify-simple-rss/scripts/verify.mjs sweep --tag before --screens search --targets d1180
```

```bash
node .claude/skills/verify-simple-rss/scripts/verify.mjs sheet --tags before,after --target d1180 --screens search,feeds
```

`sheet` prints `identical:` when two captures match byte for byte. That means your change is not live or does not reach that screen. Stop and find out why before reading anything into the images.

**User paths.** Build first, because these specs run against `dist/client`. Run one worker and log to a file.

```bash
pnpm build:client > .temp/verify/build.log 2>&1
```

```bash
pnpm exec playwright test tests/browser/search.spec.ts --workers=1 -g "gives a matching Feed" > .temp/verify/spec.log 2>&1
```

Parallel workers failed 39 of 121 tests on this machine at setup, while the same tests pass serially. A failure in a parallel run proves nothing.

## Evidence

Everything lands in `.temp/verify/`, which is gitignored and survives `down`. A sweep writes `<tag>/<target>/<screen>.png` and `<tag>/metrics.json`. `sheet` writes `sheet-<tags>-<target>.png`.

Before reporting UI work as done:

- Sweep every target for the screens you touched, plus every screen that uses a component you changed. `FeedRow` alone appears on Feeds and Search.
- Look at the screenshots. A clean sweep says nothing about whether the result looks good.
- Show a new layout test failing on the old code, not only passing on the new. Restore with `git checkout -- <paths>` only when the tree was clean before you started.
- Prove a state change with a spec: hover, focus, click then pointer away, keyboard, and geometry before and after a toggle. Screenshots of a resting page miss all of these.
- Name what you did not check as `Not verified`. Real Feeds, real phones and Safari are not covered unless you ran them.

## Cleanup

```bash
node .claude/skills/verify-simple-rss/scripts/verify.mjs down
```

Stops only the process group `up` started, after checking its command line. Removes `.temp/verify/.run` and keeps the evidence. If you interrupted a test run, find leftover workers by their working directory and parent process, and kill only those. Never kill by process name: other sessions run Vite and Vitest here too.

## What the checks exist to catch

Each of these happened in a real session:

- A title measured `120` after rounding was really `120.39`, and only an exact comparison showed it.
- Four prototype variants measured the same because the choice was lost on navigation. Reading those screenshots as a comparison would have been meaningless.
- A desktop fix made phones worse. The strip left the name 111px at 320px, and only a 320px sweep showed it.
- `Save` stayed visible after a click because `:focus-within` matches mouse focus. No resting screenshot shows that.
- Show all and Show less moved titles by 15px. Only measuring before and after the toggle shows that.
- A check that needed data the mock lacks was skipped by hand. Search is now fixed data in `SEARCH_ANSWER`.
