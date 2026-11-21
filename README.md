# Simple RSS

> Work in progress. Expect a lot of breaking changes and rapid improvements.

Simple RSS is an opinionated RSS reader for intentional reading. It is designed as an open-source template that one person can deploy and access from any modern phone or laptop browser.

## Motivation

*The need for content curation*: RSS is a great way to follow blogs and news. It allows you to escape from the algorithm of social media. As much as I love discovering new visual and wholesome content, I think there's value to slowing down and curating your source of information. 

*The need for a calm reader*: Many readers eventually adopt an inbox-like system of read/unread status, which turns feed posts into "rss debts" that keep accumulating into a grave yeard of unread post.

## Philosophy

- **no read/unread state**: I dont want to see un read badge as it gets out of hand pretty quick
- **Digest**: Feed Items are grouped by date and ordered chronologically without ranking.
- **Saved**: Home to your saved feed items.
- **Reader**: Read your feed item right here (powered by [defuddle](https://github.com/kepano/defuddle))
- **One user, one installation.**

## Architecture

Simple RSS is a server-authoritative application packaged as one portable Docker image:

```text
Browser
   │
   ▼
Simple RSS service
├── React/Vite client
├── Hono/Node API
├── Feed scheduler
├── Defuddle Reader extraction
└── SQLite ──► persistent /app/data volume
```

Railway is the initially supported managed deployment. One always-running service hosts the client, API, scheduler, and Reader extraction; one persistent volume stores SQLite. The same image remains suitable for other Docker hosts.

The stack is TypeScript, React, Base UI, Vite, Hono, Tailwind CSS, Zod, Drizzle, `better-sqlite3`, SQLite FTS5, and Defuddle. The repository will remain one pnpm package until a real second deployable requires another boundary.

See [the architecture document](docs/ARCHITECTURE.md) for the complete design.

## Running it

```sh
pnpm install
export SETUP_SECRET="$(openssl rand -base64 32)"   # claims the installation once
export PUBLIC_ORIGIN="http://localhost:5173"       # canonical URL this installation answers on
pnpm dev          # Vite on :5173, server on :8080
pnpm test         # server against real temporary SQLite, client in jsdom
pnpm test:browser # real Chromium against the built client
pnpm test:smoke   # builds the image and exercises the container (needs Docker)
```

Some sandboxes resolve every hostname to `198.18.0.1`. Set `ALLOW_RESERVED_FETCH_DESTINATIONS=true` so feed fetches may use the `198.18.0.0/15` benchmarking range. No other private or reserved range is allowed. When `NODE_ENV` is `production`, the server ignores the variable and logs a warning at startup.

[Deployment, configuration, and operational commands](docs/DEPLOYMENT.md).

## Domain and decisions

- [Domain language](CONTEXT.md)
- [ADR 0001: Server-authoritative single-user model](docs/adr/0001-server-authoritative-single-user.md)
- [ADR 0002: Container-first Railway deployment](docs/adr/0002-container-first-railway-deployment.md)
- [ADR 0003: Application-owned authentication](docs/adr/0003-application-owned-single-user-authentication.md)
- [ADR 0004: The API is closed by default](docs/adr/0004-api-closed-by-default.md)
- [ADR 0005: One hardened outbound retrieval boundary](docs/adr/0005-one-hardened-outbound-retrieval-boundary.md)
- [ADR 0006: Keyset pages over the computed chronology](docs/adr/0006-keyset-pages-over-the-computed-chronology.md) (superseded by 0011)
- [ADR 0007: Record Subscriptions before their first retrieval](docs/adr/0007-record-subscriptions-before-their-first-retrieval.md) (narrowed to OPML Import by 0012)
- [ADR 0008: Interactive behavior from Base UI](docs/adr/0008-interactive-behavior-from-base-ui.md)
- [ADR 0009: Rank Search by match quality blended with recency](docs/adr/0009-rank-search-by-match-quality-blended-with-recency.md)
- [ADR 0010: The v2 design system](docs/adr/0010-v2-design-system.md)
- [ADR 0011: Page the Digest by whole days over a stored chronology](docs/adr/0011-page-the-digest-by-whole-days-over-a-stored-chronology.md)
- [ADR 0012: Check a Subscription before recording it](docs/adr/0012-check-a-subscription-before-recording-it.md)
- [ADR 0013: Back up with VACUUM INTO, and restore only into an empty data directory through a verified staging copy](docs/adr/0013-backup-and-restore.md)
- [ADR 0014: Place every day in the installation timezone on the server, and send it as a day key](docs/adr/0014-installation-timezone-day-keys.md)
- [ADR 0015: Let append-only migrations own the schema, with Drizzle as query-side typing](docs/adr/0015-migrations-own-the-schema.md)
- [ADR 0016: Report a failed startup through readiness, and exit only when the running state is unknown](docs/adr/0016-report-failure-through-readiness.md)
- [ADR 0017: Read the search line as words, not query syntax](docs/adr/0017-search-line-is-words.md)
- [ADR 0018: Load nothing from outside the installation](docs/adr/0018-load-nothing-from-outside-the-installation.md)
- [ADR 0019: Believe the forwarded headers of the nearest proxy only](docs/adr/0019-trust-the-nearest-proxy.md)
- [ADR 0020: Extract an Original webpage once per Feed Item, inside a deadline, with a cooldown for pages that keep failing](docs/adr/0020-extract-the-original-webpage-once-per-feed-item.md)
- [ADR 0021: Poll Feeds from persisted due times, and let only a publisher's answer change Feed Availability](docs/adr/0021-poll-feeds-from-persisted-due-times.md)
- [ADR 0022: Read Feed documents as publishers write them, and key each Feed Item on the identity least likely to change](docs/adr/0022-read-feed-documents-as-publishers-write-them.md)
- [ADR 0023: Revive a retained Feed under its own row when the User subscribes to it again](docs/adr/0023-revive-a-retained-feed-under-its-own-row.md)
- [ADR 0024: Treat publisher content as hostile: refuse entity declarations, bound every body, and rebuild Markdown from an allowlist](docs/adr/0024-treat-publisher-content-as-hostile.md)
- [ADR 0025: Render articles with Streamdown, trimmed and styled by the client](docs/adr/0025-article-renderer.md)
- [ADR 0026: Play the Digest's motion on the finished screen](docs/adr/0026-digest-motion.md)
- [ADR 0027: Keep keyboard focus in drawn order and announce every answer](docs/adr/0027-focus-and-announcements.md)
- [ADR 0028: Keep the client's navigation state in the address and on the history entry](docs/adr/0028-navigation-state-in-history.md)
- [ADR 0029: Correct browser and font behaviour at the element it affects](docs/adr/0029-platform-corrections.md)
- [ADR 0030: Tell the User whether the server answered, and read a screen again only when its key changes](docs/adr/0030-whether-the-server-answered.md)
- [ADR 0031: Test the real service on disk, independent of the machine running it](docs/adr/0031-real-service-independent-of-the-machine.md)

