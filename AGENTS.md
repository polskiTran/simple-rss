# simple-rss

An opinionated, opensource RSS reader: one pnpm package, one Docker image, one SQLite file. `README.md` has the philosophy; `docs/ARCHITECTURE.md` the accepted design.

## Map

- `src/server/` — the whole service: Hono API plus in-process scheduler, one folder per domain area (`subscriptions/`, `digest/`, `library/`, `reader/`, `images/`, `search/`, `retention/`, `auth/`, `persistence/`, `upstream/`).
- `src/client/` — the React/Vite UI.
- `src/shared/api.ts` — the Zod contract both sides import. Any API change starts here.
- `tests/server/` (harness-driven), `tests/browser/` (Playwright), `tests/smoke/` (container), `tests/support/` (the harness itself).

## Conventions

- **pnpm only**, Node ≥ 22. Scripts live in `package.json`.
- **Vocabulary**: use `CONTEXT.md` terms verbatim in code, tests, issues, and commits — each entry lists the synonyms to avoid.
- **ADRs are binding**: read the ones in `docs/adr/` touching your area before designing; if your work contradicts one, surface it rather than silently overriding. The one every feature hits: all outbound HTTP (feed polling, Reader extraction, image proxy) goes through the hardened `Retrieval` module in `src/server/upstream/` (ADR 0005) — callers state an operation, never touch the raw adapter.
- **Scope**: `docs/ROADMAP.md` lists what v1 deliberately excludes (read/unread state, multiple users, tags, notifications…). Check it before adding a capability.
- **UI work**: `docs/DESIGN.md` is the design system — one repeated content shape, whitespace-only separation, accent reserved for saved state.

## Writing

The bar for comments, docstrings, and `docs/` prose:

- **A comment earns its line by saying what the code cannot**: a constraint, a reason, a gotcha, the ADR behind a choice. One that restates its own code is a no-op; delete it.
- **One or two lines.** If a comment needs a paragraph, the reasoning belongs in an ADR or `docs/`.
- **Plain declarative sentences.** State the fact once and move on; if a clause can go without losing a fact, it goes.
- **Comments describe current behavior.** When behavior changes, update its comments in the same commit; if you cannot make a comment true, delete it.

## Verify

- `pnpm typecheck && pnpm test` is the default loop before calling work done. Server tests run the real service against a temporary SQLite via `tests/support/service-harness.ts` — manual clock, upstream fixtures, injected `Retrieval`. Write new server tests through the harness rather than mocking internals.
- `pnpm test:browser` when client-visible behavior changes (builds the client, runs real Chromium).
- `pnpm test:smoke` only when `Dockerfile` or container behavior changes (needs Docker).

## Issue tracker

Issues live in GitHub Issues on `polskiTran/simple-rss`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

## Triage labels

The five canonical triage roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

## Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
