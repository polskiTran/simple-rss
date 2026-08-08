# Running Simple RSS

One image, one process, one volume. See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for why.

## Configuration

Everything is read from the environment at startup. A bad value fails the
process immediately rather than at the first request that trips over it.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port. Injected by the platform; the image never hard-codes one. |
| `DATA_DIR` | `./.data` (`/app/data` in the image) | The mounted volume. Everything durable lives below it. |
| `CLIENT_DIR` | `dist/client` beside the server | Built client assets. |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |
| `SHUTDOWN_GRACE_MS` | `10000` | How long in-flight requests may finish after `SIGTERM`. |

## Health checks

| Path | Meaning |
|---|---|
| `GET /health/live` | The process and event loop can respond. Never fails for a Feed, Reader, or upstream network problem. |
| `GET /health/ready` | Startup migrations completed **and** SQLite still accepts writes. Answers `503` with a reason otherwise. |

Point the platform's liveness check at `/health/live` and its readiness check at
`/health/ready`. A migration failure or a full volume keeps readiness closed
while liveness stays green, so an operator can read the reason in the logs
instead of watching a restart loop.

## Building the image

The released image targets `linux/amd64`:

```sh
docker build --platform linux/amd64 -t simple-rss:$(node -p "require('./package.json').version") .
```

The Dockerfile itself is architecture-neutral — building without `--platform`
produces an image for the host, which is what local development wants. Building
`linux/amd64` on an arm64 machine needs qemu binfmt registered
(`docker run --privileged --rm tonistiigi/binfmt --install amd64`); CI builds it
natively on an amd64 runner instead.

## Running it

```sh
docker run -d \
  --name simple-rss \
  -p 8080:8080 \
  -v simple-rss-data:/app/data \
  simple-rss:0.1.0
```

The container runs as the unprivileged `node` user, writes structured JSON logs
to stdout, and stops gracefully on `SIGTERM`.

## Railway

The supported shape is in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#supported-railway-shape):
one Hobby-plan service, one replica, sleep disabled, restart policy `Always`,
and one volume mounted at `/app/data`.

Railway mounts the volume only at runtime, so migrations run during application
startup rather than as a pre-deploy command. That is why readiness — not
liveness — is the gate that holds traffic back.

## Operational commands

Run these through the platform shell. They act on the mounted volume directly
and need no HTTP session.

```sh
node dist/server/cli-main.js migrate                    # apply pending migrations
node dist/server/cli-main.js show                       # print installation settings
node dist/server/cli-main.js set-timezone Europe/Berlin  # set the Digest timezone
```

## Upgrading

Installations never follow a mutable `latest` tag. Pick a version deliberately
and take a backup first — replacing the container while retaining the volume is
what preserves state, and the container smoke tests cover exactly that path.

## Local development

```sh
pnpm install
pnpm dev          # Vite on :5173 proxying /api and /health to the server on :8080
pnpm test         # in-process suite: server on real temporary SQLite, client in jsdom
pnpm test:smoke   # builds the image and exercises the container (needs Docker)
pnpm typecheck
pnpm build && pnpm start
```
