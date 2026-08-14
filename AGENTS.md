# simple-rss

An opinionated, opensource RSS reader: one pnpm package, one Docker image, one SQLite file. `README.md` has the philosophy; `docs/ARCHITECTURE.md` the accepted design.

## Project map

- `src/server/` — the whole service: Hono API plus in-process scheduler, one folder per domain area (`auth/`, `digest/`, `export/`, `http/`, `images/`, `ingestion/`, `library/`, `persistence/`, `reader/`, `retention/`, `search/`, `subscriptions/`, `upstream/`).
- `src/client/` — the React/Vite UI.
- `src/shared/api.ts` — the Zod contract both sides import. Any API change starts here.
- `tests/server/` (harness-driven), `tests/browser/` (Playwright), `tests/smoke/` (container), `tests/support/` (the harness itself).

pnpm only, Node ≥ 22.

<important if="you need to run commands to build, run, test, or typecheck">

| Command | What it does |
|---|---|
| `pnpm dev` | Server + client together |
| `pnpm dev:server` / `pnpm dev:client` | Either half alone |
| `pnpm build` | Build client then server (`build:client`, `build:server`) |
| `pnpm start` | Run the built server from `dist/` |
| `pnpm lint` | `biome check .` — formatting and the import boundaries (`biome.jsonc`) |
| `pnpm format` | `biome format --write .` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest (server tests) |
| `pnpm test:browser` | Builds the client, runs Playwright in real Chromium |
| `pnpm test:smoke` | Container smoke tests (needs Docker) |
| `pnpm cli` | The server CLI entrypoint |
</important>

<important if="you are about to call any piece of work done">

`pnpm lint && pnpm typecheck && pnpm test` is the default loop. Add `pnpm test:browser` when client-visible behavior changes; `pnpm test:smoke` only when `Dockerfile` or container behavior changes.
</important>

<important if="you are writing or modifying server tests">

Server tests run the real service against a temporary SQLite via `tests/support/service-harness.ts` — manual clock, upstream fixtures, injected `Retrieval`. Write new tests through the harness rather than mocking internals.
</important>

<important if="you are designing a feature, changing behavior, or touching an area covered by an ADR">

ADRs in `docs/adr/` are binding: read the ones touching your area before designing. If your work contradicts one, surface it rather than silently overriding.
</important>

<important if="you are making an outbound HTTP request — feed polling, Reader extraction, image proxy, or any new fetch">

All outbound HTTP goes through the hardened `Retrieval` module in `src/server/upstream/` (ADR 0005). Callers state an operation; they never touch the raw adapter. `pnpm lint` enforces this: raw `fetch` and `undici` are refused under `src/server/`.
</important>

<important if="you are naming things in code, tests, issues, or commit messages">

Use `CONTEXT.md` terms verbatim — each entry lists the synonyms to avoid. `CONTEXT.md` and `docs/adr/` are the single domain context; see `docs/agents/domain.md`.
</important>

<important if="you are building or restyling UI">

`docs/DESIGN.md` is the design system — one repeated content shape, whitespace-only separation, accent reserved for saved state.
</important>

<important if="you are writing comments, docstrings, or docs/ prose">

Comments describe current behavior. When behavior changes, update its comments in the same commit; if you cannot make a comment true, delete it.
</important>

<important if="you are filing, reading, labeling, or closing an issue">

Issues live in GitHub Issues on `polskiTran/simple-rss`, via the `gh` CLI — see `docs/agents/issue-tracker.md`. The five canonical triage roles are used verbatim as label strings; see `docs/agents/triage-labels.md`.
</important>
