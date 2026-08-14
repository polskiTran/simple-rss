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
| `pnpm lint` | `biome check --error-on-warnings .` — formatting and the import boundaries (`biome.jsonc`); a warning fails it |
| `pnpm format` | `biome format --write .` |
| `pnpm typecheck` | `tsc -p tsconfig.json --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest — both projects: `tests/server/` in node, `tests/client/` in jsdom |
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

<important if="you are adding an import under `src/server/`, or suppressing a lint rule">

Three boundaries hold the server's folder graph. Each is owned by exactly one mechanism, so it fails where you can see it — none of them rely on review:

- **Nothing under `src/server/` imports `src/server/http/`.** `http/` consumes the domain, never the reverse; `app.ts` is the one composition point and is exempt. Biome refuses the rest.
- **Nothing under `src/server/` calls raw `fetch` or imports `undici`** — ADR 0005, above. Biome again.
- **The folder graph stays acyclic, and `upstream/` imports no other server folder.** `tests/server/architecture.test.ts` walks it.

Two things that test cannot see. Root-level modules (`app.ts`, `service.ts`, `clock.ts`, `logger.ts`) are not nodes in the graph, so a cycle through one of them passes — when two modules need a shared interface, declare it where it is *consumed* rather than where it is built. And the scan reads text, so a type-only back-edge fails the test: that is deliberate, since a cycle a person has to trace is a cycle whether or not it survives to runtime.

Suppress a rule only with its reason attached. Every `biome-ignore` in the repo names why, and every rule turned off in `biome.jsonc` carries its reason on the line above it; a new `overrides` entry does the same. Note that an override *replaces* a rule rather than merging into it — restate what you still want.
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
