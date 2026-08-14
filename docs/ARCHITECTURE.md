# Simple RSS Architecture

> Status: accepted design; the implementation follows this document.

Simple RSS is a calm, single-user RSS reader distributed as a portable Docker image. Railway is the first documented deployment target, but provider-specific behavior stays outside the application core.

The canonical domain vocabulary is defined in [`CONTEXT.md`](../CONTEXT.md). Hard-to-reverse decisions are recorded in [`docs/adr`](./adr/).

## Goals

- Let one User use the same reader from phone and laptop browsers.
- Poll RSS and Atom Feeds reliably in the background.
- Keep Subscriptions, Feed Item metadata, Library membership, and preferences authoritative on the server.
- Remain inexpensive and straightforward to self-host.
- Prefer calm chronology over inbox and engagement mechanics.
- Keep stored data portable.

## Non-goals

V1 does not include multiple users, read/unread state, native mobile applications, PWA or offline synchronization, Feed autodiscovery, tags, folders, ranking, notifications, persistent article content, horizontal scaling, high availability, or automatic updates.

## System shape

```text
┌──────────────────────────┐
│ Modern browser           │
│ React/Vite responsive UI │
└─────────────┬────────────┘
              │ same-origin HTTPS + JSON
┌─────────────▼──────────────────────────────────────┐
│ One Simple RSS service                            │
│                                                   │
│ Hono API             In-process scheduler         │
│ Authentication       Feed ingestion               │
│ Reader extraction    Image proxy                  │
│ Static assets        Search and export            │
└─────────────┬──────────────────────────────────────┘
              │
┌─────────────▼────────────┐
│ SQLite in WAL mode       │
│ /app/data                │
│ Railway volume           │
└──────────────────────────┘
```

There is one process, one service replica, and one persistent volume. The HTTP server and scheduler share the same database module. Persisted due times allow polling to catch up after restarts or deployments.

## Deployment

### Supported Railway shape

The Railway template provisions:

- One Hobby-plan service and one replica
- Serverless/sleep behavior disabled
- Restart policy set to `Always`
- 1 vCPU limit
- 1 GB memory limit
- One volume mounted at `/app/data`
- Railway-managed HTTPS domain, with custom domains optional
- Required setup and session secrets
- Liveness and readiness health checks

Railway bills actual usage rather than configured limits. Expected consumption should remain near the Hobby plan's minimum for this workload. The 1 GB limit provides headroom without reserving or billing 1 GB when unused.

The generated Railway domain is fully supported. A custom domain is not required.

### Portability

Releases publish versioned public Docker images. The image:

- Runs on `linux/amd64`
- Accepts the platform-provided HTTP port
- Stores all durable files below `/app/data`
- Writes structured logs to stdout
- Shuts down gracefully
- Does not depend on Railway APIs for normal operation

Installations never follow a mutable `latest` tag automatically. The User deliberately selects a new version and takes a backup before upgrading.

### Single-instance consequences

SQLite and the mounted volume deliberately constrain the application to one replica. Deployments have a short downtime while the volume moves from the old container to the new one. This is acceptable for a personal reader.

A future requirement for concurrent replicas, separate worker services, or high availability would trigger a database and deployment redesign rather than adding ad hoc SQLite replication to v1.

## Technology stack

- **Language:** TypeScript
- **Package management:** pnpm, one package
- **Client:** React and Vite
- **HTTP server:** Hono on Node
- **Validation:** shared Zod schemas at API boundaries
- **UI foundation:** native HTML elements with manual ARIA, Tailwind CSS, and application-owned design tokens/components
- **Database:** SQLite through `better-sqlite3` and Drizzle
- **Search:** SQLite FTS5
- **Reader extraction:** Defuddle on the server

Next.js is intentionally absent. The private client does not need SSR, SEO, React Server Components, or framework-managed caching. Vite produces static assets that the same Hono process serves alongside `/api` routes.

The interface uses no visually prescriptive component suite and no headless-component library. Every interactive control is a native element — `<button aria-pressed>` for toggles, `<a aria-current="page">` inside a labelled `<nav>` for the tab bar, `role="group"` around related choices — with accessible behavior hand-built rather than supplied. Typography, spacing, color, density, and motion are owned entirely by Simple RSS.

## Application boundaries

The single package should still expose clear modules rather than mixing concerns:

- **Client:** views, interactions, browser caching, and same-origin API calls
- **HTTP:** routing, cookies, request validation, rate limiting, and response policy
- **Authentication:** setup, credentials, sessions, and emergency reset
- **Subscriptions:** Feed lifecycle and preferences, held as three collaborating classes in one folder rather than one service doing all three jobs — `SubscriptionService` owns every Subscription write (create, OPML, unsubscribe, polling interval), `FeedPoll` owns the retrieve-parse-persist pipeline for one Feed, and `FeedAvailability` owns the three Feed Availability writes (`recordSuccess`, `recordFailure`, `recordDeferral`)
- **Retrieval:** the one hardened boundary every outbound request passes through — destination and redirect validation, deadlines, decoded-size ceilings, and retrieval budgets
- **Ingestion:** parsing, normalization, identity, and polling state
- **Digest:** chronology and date grouping
- **Library:** saved membership and retention protection
- **Reader:** safe page retrieval, Defuddle conversion, sanitization, and retry
- **Media:** Feed and Reader image proxying
- **Search:** FTS indexing and queries
- **Persistence:** connection usership, transactions, migrations, and backups
- **Operations:** scheduler, health checks, logs, cleanup, and exports

These are source-code boundaries, not separate packages or services.

`src/server/service.ts` is the composition root: it builds every domain service once, inside a single `try`/`catch`. A startup failure — the database won't open, or migrations fail — is recorded on `Readiness` rather than thrown, so the process stays up to report the reason on `/health/live` while `/health/ready` closes. On success the built instances are bundled into one `Services` value and handed to `createApp` (`src/server/app.ts`), which branches on that bundle exactly once, at construction: with services, every route module is wired with real instances; without them, all of `/api` answers 503 and no route has to ask again. A domain service is either fully constructed or the installation is not serving `/api`.

## Persistence model

The initial relational model contains:

| Record | Responsibility |
|---|---|
| `installation_settings` | Singleton timezone and installation preferences |
| `user_auth` | Singleton setup state and Argon2id password verifier |
| `sessions` | Hashed opaque session tokens and expiry state |
| `feeds` | External Feed identity, URL, metadata, and retrieval validators |
| `subscriptions` | Active relationship, Polling Interval, due time, and availability state |
| `feed_items` | Normalized metadata and observation timestamps |
| `library_items` | Saved membership and saved time |
| FTS virtual tables | Rebuildable search indexes |
| migration metadata | Applied schema versions |
| `write_probe` | One row rewritten by the readiness check to prove the volume still accepts writes |

There are no account, tenant, role, or registration tables.

### SQLite rules

- Enable WAL journal mode.
- Configure a busy timeout.
- Keep write transactions short.
- Use parameterized queries exclusively.
- Run explicit, versioned migrations before the server becomes ready.
- Keep FTS indexes rebuildable from canonical tables.
- Do not run multiple Node workers or service replicas against the volume.

Railway mounts the volume only at runtime, so migrations run during application startup rather than as a Railway pre-deploy command. A migration failure keeps readiness closed.

## Feed lifecycle

### Adding a Subscription

V1 accepts an exact RSS or Atom URL; it does not discover Feeds from website URLs.

Subscribing and OPML Import record the Subscription without contacting the Feed (ADR 0007). The server validates the URL shape, deduplicates against known Feed URLs, and creates the Feed and Subscription transactionally; the Subscription starts unchecked and immediately due, and the request nudges the scheduler awake. The first retrieval is an ordinary poll: it confirms RSS or Atom content, corrects the Feed's title and resolved URL, and ingests the current Feed Window. A first retrieval that reveals an already-subscribed Feed behind a different URL quietly merges the later Subscription into it.

The entered URL is preserved while a validated resolved URL may be recorded for subsequent retrievals. One OPML import records at most 500 Feeds; a wake that finds a full due batch drains the next batch at once, so an import's first checks finish at the pace of the retrieval budgets rather than one batch per minute.

### Feed retrieval limits

- HTTP and HTTPS only
- Ten seconds to answer, counted across resolution, connection, and every redirect hop
- Sixty further seconds for the answer to finish arriving, reported separately from a publisher that never answered
- Five redirects at most
- Twenty MiB decoded Feed body
- Redirect destinations revalidated independently
- No credentials, localhost, private/reserved destinations, or self-reference
- No forwarding of browser credentials or cookies

### Polling

The scheduler wakes once per minute and queries indexed `next_poll_at` values. Accepted Polling Interval presets are 30 minutes, 1 hour, 2 hours, 6 hours, 12 hours, and daily; the default is 2 hours.

Polling uses:

- A bounded batch and concurrency cap
- Per-Feed overlap protection
- Deterministic jitter to avoid synchronized bursts
- Conditional requests with ETag and Last-Modified
- Persisted attempt, success, failure, and next-due state
- Exponential failure backoff capped at 24 hours
- Startup catch-up after downtime

Manual refresh is authenticated, rate-limited, and coalesced with an existing poll. It does not change the Polling Interval.

Three consecutive failures surface calm Feed Availability information. Failures never unsubscribe a Feed automatically.

### Feed Item identity and updates

Feed Items deduplicate only within their Feed using a unique `(feed_id, dedupe_key)` constraint. Identity prefers RSS GUID or Atom ID, falls back to a normalized link, and finally to a deterministic content fingerprint. The same link appearing in different Feeds remains separate.

When an identified item reappears, title, link, plain-text summary, image URL, and corrected publication time may update. Identity, first-seen time, and Library membership remain stable.

Feed-provided summaries are normalized to safe plain text before storage.

### Chronology

Timestamps are stored in UTC. One installation timezone, detected during setup and editable later, defines Digest calendar groups across devices.

Items order by a valid publication time and fall back to first-seen time. Clearly implausible future dates use first-seen ordering. The Digest groups items under Today, Yesterday, and then calendar dates, with no read/unread partition.

### Retention and unsubscribe

An unsaved Feed Item becomes eligible for pruning 90 days after it was last observed in a Feed Window. Items in a slow-moving Feed therefore remain retained while the Feed continues exposing them. Library items are never pruned by this policy.

Unsubscribing immediately removes the Feed from the Digest and stops polling. Unsaved items are deleted during cleanup; Library items and the minimum Feed attribution they need remain.

## Library and search

Library membership is explicit and independent of reading or Reader View success. Saving and unsaving are authenticated server mutations.

SQLite FTS5 indexes Feed titles, item titles, and normalized summaries. Search covers retained Feed Items and Library items. FTS data is derived and excluded from portable exports.

## Reader View

Reader View is generated only when requested:

1. The client requests a Feed Item by ID, never an arbitrary URL.
2. The server retrieves the stored original link through the hardened retrieval boundary.
3. The response must be HTML and no larger than five MiB decoded.
4. Defuddle produces temporary Markdown.
5. Output is sanitized through an explicit allowlist.
6. Reader image URLs are replaced with signed proxy URLs.
7. Markdown is returned with `Cache-Control: private, max-age=86400`.

Allowed output includes headings, paragraphs, lists, links, images, block quotes, tables, code, and supported math. Scripts, styles, forms, iframes, embedded media, event handlers, and arbitrary raw HTML are removed. External links use `noopener noreferrer`.

The client renders that Markdown with Streamdown, KaTeX, and Shiki, and takes the renderer's own styling for the article's blocks. Raw HTML has no path through it — rehype-raw is left out of the plugin list and stubbed out at the bundler — and links and images pass through the reading surface's own components, so rendering can admit nothing the server's allowlist excluded.

Article HTML and Markdown are never written to SQLite. Extraction failures preserve the Feed Item, show its stored summary and an **Open original** action, and expose a rate-limited **Retry parsing** action. Failed extraction responses are not cached.

## Image proxy

The image proxy protects the User from direct publisher requests and allows a strict `img-src 'self'` content security policy.

- Primary Feed Item images use an item-ID route.
- Reader images use short-lived signed URLs generated during extraction.
- Arbitrary unsigned target URLs are never accepted.
- The proxy reuses hardened URL and redirect validation.
- Responses stream with a five MiB limit.
- JPEG, PNG, WebP, GIF, and AVIF are accepted; SVG is rejected.
- Source cookies and credentials are never forwarded.
- Successful responses use private browser caching for seven days.
- Authentication, concurrency limits, and rate limits apply.

The proxy performs no resizing or image transformation in v1.

## Authentication and security

### First-run setup

The Railway template supplies a required random setup secret. Before setup completes, only setup and health routes are available. The User presents the setup secret and chooses a password. The server stores an Argon2id verifier and permanently disables setup after successful initialization. Missing setup configuration fails readiness closed.

There is no registration, email recovery, OAuth, role model, or second User.

Only `/health/*` and the exact paths `/api/auth/status`, `/api/auth/setup`, and `/api/auth/session` are reachable without a session. Mounting another route under `/api/auth` does not exempt it. Everything else under `/api` is closed by default — see [ADR 0004](./adr/0004-api-closed-by-default.md) — so an unclaimed installation exposes setup and health behavior and nothing more.

### Sessions

- Opaque random session tokens, 256 bits from the system CSPRNG
- Only `sha256(token)` stored in SQLite, so a copy of the volume grants nothing
- `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` cookies
- Seven-day idle timeout, slid at most once a minute rather than per request
- Thirty-day absolute timeout, fixed at issue and never extended
- Independent sessions for phone and laptop
- Logout invalidates the current session
- Password changes and emergency reset invalidate every session
- Sessions past either deadline are deleted when encountered, and swept at startup

An authenticated User can change the password normally. Emergency recovery uses a CLI command through the Railway shell; it installs a new Argon2id verifier and revokes all sessions.

### Rate limiting

The single service uses local rate limiting and requires no Redis. Every route that checks a secret — sign-in, claiming with the setup secret, and changing the password — goes through the same limiter, so the setup secret is no cheaper to guess than the password.

A client is refused after five failed attempts in 15 minutes, and every attempt costs a progressive delay that doubles from 250 ms to a 2 s cap. Both are sliding windows over recorded failures, so waiting is always sufficient and a successful attempt clears that client.

The installation-wide ceiling of twenty failures works differently on purpose: past it, **every** attempt pays the maximum delay, but no client is blocked by failures that were not its own. A hard global block would let anyone with a handful of addresses keep the User out of their own reader by failing twenty sign-ins every quarter of an hour — the permanent lockout this is meant to avoid. Spread-out guessing is answered by capping the rate instead, on top of a memory-hard verify and a five-attempt limit per address.

Limiter state is in memory. It is not persisted and not exported: losing it costs an attacker nothing they could not get by waiting out the window, and only the User can restart the process.

The client an attempt counts against is the **rightmost** `X-Forwarded-For` entry — the one the nearest proxy appended — falling back to the socket address. Anything further left is caller-supplied, so a forged header can only ever spend the attacker's own budget. `TRUST_PROXY_HEADERS=false` ignores the header entirely for a directly exposed deployment.

### Web and fetch security

- Same-origin JSON API; no permissive credentialed CORS
- Server-side Zod validation at every request boundary
- Origin checks for state-changing requests: the `Origin` host must equal the request `Host`, and a missing or opaque `Origin` is refused
- Parameterized SQL
- Restrictive CSP and standard security headers
- Render-time output escaping and Reader sanitization
- Fetch destination and redirect validation to reduce SSRF, in one boundary every retrieval passes through — see [ADR 0005](adr/0005-one-hardened-outbound-retrieval-boundary.md)
- Destination addresses validated inside the lookup the connection itself uses, so a name cannot resolve differently for the check and for the socket
- `PUBLIC_ORIGIN` refused as a destination, so the reader cannot be steered into its own API
- Body, timeout, concurrency, and content-type limits
- No secrets, sessions, Feed summaries, Reader content, or full query strings in logs

## API and client behavior

The client and server communicate through same-origin JSON REST routes under `/api`. Zod schemas and inferred TypeScript types are shared within the package. V1 does not promise a public integration API.

The client is a responsive web application, not a PWA. It has no service worker, install manifest, client database, offline mutations, or synchronization protocol. Ordinary private browser caching is allowed. Network loss produces an explicit unavailable state rather than simulated offline operation.

## Exports and backups

### Portable exports

OPML is the interoperability format for Subscriptions. A versioned JSON export includes:

- Subscriptions and Polling Intervals
- Feed metadata
- Retained Feed Items
- Library membership
- Installation preferences
- Export/schema version

Exports exclude password verifiers, setup secrets, sessions, rate-limit state, caches, FTS tables, and migration internals.

### Backups

V1 relies on:

- Railway daily volume backups
- A documented application-consistent SQLite backup command
- OPML and complete JSON export
- Explicit backup-before-upgrade guidance

S3/R2 credentials and automated off-platform replication are not installation requirements. Optional off-platform backup automation may be added later. Restore procedures must be documented and tested before the first stable release.

## Operations

### Health

- **Liveness:** the process and event loop can respond.
- **Readiness:** startup migrations completed and SQLite is writable.

Individual Feed, Reader, image, and upstream-network failures do not make the container unhealthy.

### Observability

The service emits structured logs to stdout and exposes Feed Availability in the application. It sends no analytics or telemetry by default. Sensitive values and reading content are never logged.

### Failure behavior

- Restarted scheduler work catches up from persisted due times.
- Feed failures back off and remain visible without automatic removal.
- Reader failures fall back to summary and original link.
- Image failures show a stable visual fallback.
- Migration failure keeps the deployment unready.
- A full or unwritable volume makes readiness fail.

## Verification strategy

The test suites cover:

- Unit tests for identity, chronology, retention, and backoff rules
- Integration tests against real temporary SQLite databases and FTS5
- Fixture-driven RSS and Atom parser tests
- Hardened-fetch tests for redirects, private targets, timeouts, size limits, and MIME mismatches
- Authentication, session, rate-limit, CSRF, and setup-race tests
- Reader sanitization and image-signature tests
- Migration and backup/restore tests
- Browser tests for setup, login, Digest, Subscription, Library, search, and Reader fallback
- Container smoke tests using a mounted persistent directory

Each layer takes only what the one below it cannot prove. The HTTP boundary suite (`pnpm test`) covers behaviour a request can observe; `pnpm test:browser` is reserved for what needs a real browser — cookie attributes, script's inability to read the session, and a foreign origin genuinely failing to act; `pnpm test:smoke` is reserved for what needs the real image and volume.

## V1 acceptance boundary

V1 is complete when a new User can deploy the Railway template, claim it safely, subscribe or import Feeds, receive background updates, browse a chronological Digest, save and search items, use Reader View with safe fallbacks, export portable state, upgrade deliberately, and restore documented backups—all from modern phone and laptop browsers.
