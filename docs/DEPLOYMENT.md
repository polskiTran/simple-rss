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
| `SETUP_SECRET` | — | The one-time secret that lets the first visitor become the Owner. **Required until the installation is claimed**; ignored afterwards. At least 16 characters. |
| `PUBLIC_ORIGIN` | — | The origin the Owner reaches this installation at, e.g. `https://reader.up.railway.app`. Optional but worth setting: it lets outbound retrieval refuse a Feed or Feed Item link that points back at the installation itself. Without it, only localhost, private, and reserved destinations are refused. |
| `TRUST_PROXY_HEADERS` | `true` | Whether `X-Forwarded-For` may be believed when identifying a client for rate limiting. Leave it on behind a platform proxy; set `false` if the service is exposed directly. |

Generate the setup secret with something that is not a word:

```sh
openssl rand -base64 32
```

An unclaimed installation with no usable `SETUP_SECRET` **stays unready** and
says so — there would be no safe way to claim it, so serving it would only
offer a dead end. A claimed installation no longer needs the variable at all.

## Health checks

| Path | Meaning |
|---|---|
| `GET /health/live` | The process and event loop can respond. Never fails for a Feed, Reader, or upstream network problem. |
| `GET /health/ready` | Startup migrations completed, SQLite still accepts writes, **and** the installation can be claimed or already has been. Answers `503` with a reason otherwise. |

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
  -e SETUP_SECRET="$(openssl rand -base64 32)" \
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
node dist/server/cli-main.js migrate                     # apply pending migrations
node dist/server/cli-main.js show                        # print installation settings
node dist/server/cli-main.js set-timezone Europe/Berlin  # set the Digest timezone
node dist/server/cli-main.js reset-password              # emergency password reset
```

Each command reports on stdout; log records go to stderr, so the output can be
piped into `jq`.

## Claiming the installation

Open the deployed URL. An unclaimed installation shows one screen: the setup
secret and a password of at least 12 characters. Nothing else is reachable
until it is claimed, and setup closes permanently the moment it is — the secret
cannot make a second Owner afterwards, so it can be left in place or removed.

Sessions are cookies holding an opaque random token whose hash alone is stored.
A device stays signed in for seven days of inactivity and at most thirty days
in total; a phone and a laptop hold independent sessions. Signing out ends that
one device's session, while changing the password ends all of them.

### Losing the password

There is no recovery email, no OAuth, no security question, and no second
Owner. Recovery is a shell command on the volume:

```sh
SIMPLE_RSS_NEW_PASSWORD='…' node dist/server/cli-main.js reset-password
```

It installs the new password and revokes every session, so a device that was
signed in when the password was lost does not stay signed in. It also claims an
installation that was never claimed, which recovers a deployment whose setup
secret went missing before it was used. Passing the password as an argument
works too — `reset-password '…'` — but puts it in the shell history, so prefer
the variable.

## Upgrading

Installations never follow a mutable `latest` tag. Pick a version deliberately
and take a backup first — replacing the container while retaining the volume is
what preserves state, and the container smoke tests cover exactly that path.

## Local development

```sh
pnpm install
export SETUP_SECRET="$(openssl rand -base64 32)"   # the server stays unready without it
pnpm dev          # Vite on :5173 proxying /api and /health to the server on :8080
pnpm test         # in-process suite: server on real temporary SQLite, client in jsdom
pnpm test:browser # real Chromium against the built client (needs `playwright install chromium`)
pnpm test:smoke   # builds the image and exercises the container (needs Docker)
pnpm typecheck
pnpm build && pnpm start
```
