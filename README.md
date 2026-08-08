# Simple RSS

> Work in progress

Simple RSS is an opinionated, extremely minimal RSS reader for intentional and calm reading. It is designed as an open-source template that one person can deploy and access from any modern phone or laptop browser.

## Motivation

RSS is a great way to follow blogs and news without surrendering control to an algorithm. Many readers eventually adopt inbox mechanics, productivity metrics, and dense interfaces that turn reading into another obligation. Simple RSS deliberately avoids that direction.

## Philosophy

- **no read/unread state**: I dont want to see un read badge as it gets out of hand pretty quick
- **Digest**: Feed Items are grouped by date and ordered chronologically without ranking.
- **Library**: Home to your saved feed items.
- **Reader**: Read your feed item right here (powered by [defuddle](https://github.com/kepano/defuddle))
- **One user, one installation.**

## Planned v1

- Single-Owner setup and login
- RSS and Atom Subscriptions
- OPML import and export
- Digest grouped by date
- Configurable per-Feed Polling Intervals
- Manual Feed refresh and availability status
- Library for saved Feed Items
- Search across Feed titles, item titles, and summaries
- On-demand Reader View with retry and original-page fallback
- Privacy-preserving Feed and Reader image proxying
- Complete portable JSON export
- Responsive web interface

see the roadmap over at [roadmap doc](docs/ROADMAP.md)

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

The planned stack is TypeScript, React, Vite, Hono, Base UI, Tailwind CSS, Zod, Drizzle, `better-sqlite3`, SQLite FTS5, and Defuddle. The repository will remain one pnpm package until a real second deployable requires another boundary.

See [the architecture document](docs/ARCHITECTURE.md) for the complete design.

## Domain and decisions

- [Domain language](CONTEXT.md)
- [ADR 0001: Server-authoritative single-owner model](docs/adr/0001-server-authoritative-single-owner.md)
- [ADR 0002: Container-first Railway deployment](docs/adr/0002-container-first-railway-deployment.md)
- [ADR 0003: Application-owned authentication](docs/adr/0003-application-owned-single-owner-authentication.md)

