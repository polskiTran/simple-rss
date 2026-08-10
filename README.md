# Simple RSS

> Work in progress. 

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

- Single user setup and login
- RSS and Atom Subscriptions
- OPML import and export
- Digest grouped by date
- Configurable per feed Polling Intervals
- Manual Feed refresh and availability status
- Library for saved Feed Items
- Search across Feed titles, item titles, and summaries
- Reader view 
- Feed and Reader image proxying
- JSON setting export
- Responsive web interface for both desktop and mobile web usage

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

[Deployment, configuration, and operational commands](docs/DEPLOYMENT.md).

## Domain and decisions

- [Domain language](CONTEXT.md)
- [ADR 0001: Server-authoritative single-user model](docs/adr/0001-server-authoritative-single-user.md)
- [ADR 0002: Container-first Railway deployment](docs/adr/0002-container-first-railway-deployment.md)
- [ADR 0003: Application-owned authentication](docs/adr/0003-application-owned-single-user-authentication.md)
- [ADR 0004: The API is closed by default](docs/adr/0004-api-closed-by-default.md)
