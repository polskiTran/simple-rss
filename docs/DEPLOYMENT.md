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
| `PUBLIC_ORIGIN` | — | **Required.** The canonical HTTP or HTTPS origin the Owner uses, e.g. `https://reader.up.railway.app`. Outbound retrieval refuses this origin so a Feed or Feed Item link cannot point the installation back at its own API. |
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
  -e PUBLIC_ORIGIN="https://reader.example.com" \
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
node dist/server/cli-main.js rebuild-search              # rebuild the derived search index
node dist/server/cli-main.js backup /app/data/backups/simple-rss-2026-08-09.db
node dist/server/cli-main.js restore /app/data/backups/simple-rss-2026-08-09.db
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

## Exports

Settings offers two downloads, both for the signed-in Owner only:

- **`subscriptions (OPML)`** — the active Subscriptions as an OPML 2.0
  document any other reader imports.
- **`everything (JSON)`** — the complete portable reading state: Subscriptions
  and Polling Intervals, Feed metadata, retained Feed Items, Library
  membership, the installation timezone, and the export and schema versions.
  It never contains the password verifier, sessions, the setup secret,
  retrieval caches, or any other operational state, so the file is safe to
  keep anywhere the Owner keeps documents.

Exports are portability, not disaster recovery — the JSON file preserves
reading state, but restoring an installation wholesale is what backups are for.

## Backups

Railway's daily volume backups are the default safety net; nothing has to be
configured for them, and no S3/R2 credentials or off-platform replication are
required. Take an explicit backup before anything deliberate — an upgrade, a
migration to another host — with the CLI:

```sh
node dist/server/cli-main.js backup /app/data/backups/simple-rss-2026-08-09.db
```

The command uses SQLite's `VACUUM INTO`, so the snapshot is
application-consistent even while the service is running — never copy the live
`simple-rss.db` file directly, because a raw copy of an open WAL database can
be torn. The snapshot is written under a temporary name and renamed only once
complete, so a file at the destination is always a finished backup; the
command refuses to overwrite an existing file and reports failures on stdout
with a non-zero exit code. Copy the snapshot off the volume (e.g. download it
through the platform shell) if it should survive the volume itself.

## Restoring

Restore initializes a **fresh** data directory from a snapshot — it refuses to
run where a database already exists, so it can never silently clobber a live
installation:

```sh
# 1. Provision a service with an empty volume (or empty the data directory).
# 2. From the platform shell:
node dist/server/cli-main.js restore /path/to/simple-rss-2026-08-09.db
# 3. Start (or restart) the service and verify readiness before using it:
curl -fsS "$PUBLIC_ORIGIN/health/ready"
```

The command verifies the snapshot's integrity, applies any migrations a newer
build ships, rebuilds the derived search index from the restored Feed Items,
and proves the directory is writable — all against a staging copy that only
replaces `simple-rss.db` after every check passed. A failed restore leaves the
data directory uninitialized and the service unready, and says why.

A restored installation preserves Subscriptions and their Polling Intervals,
retained Feed Items, Library membership, installation settings, and Owner
access — the same password signs in, because the Owner's verifier lives in the
database. What a backup does not carry is anything derived or in flight:
Reader renderings and proxied images are re-fetched on demand, and Feed Items
published between the backup and the restore arrive with the next poll.

## Upgrading

Installations never follow a mutable `latest` tag, and nothing updates
automatically. Upgrading is deliberate:

1. Take a backup (above).
2. Pick an explicit image version — a tag like `simple-rss:0.2.0`, never
   `latest` — and replace the container while retaining the volume. That is
   what preserves state, and the container smoke tests cover exactly that path.
3. Watch `/health/ready`: the new build applies its migrations during startup
   and holds traffic until they finish.

Migrations only move forward — a newer build never downgrades a database, and
an older build must not be pointed at a volume a newer one migrated. Rolling
back therefore means the backup, not the old image alone: deploy the previous
image version against a fresh data directory restored from the pre-upgrade
snapshot, accepting that anything that happened after that snapshot is lost.

## Local development

```sh
pnpm install
export SETUP_SECRET="$(openssl rand -base64 32)"   # the server stays unready without it
export PUBLIC_ORIGIN="http://localhost:5173"
pnpm dev          # Vite on :5173 proxying /api and /health to the server on :8080
pnpm test         # in-process suite: server on real temporary SQLite, client in jsdom
pnpm test:browser # real Chromium against the built client (needs `playwright install chromium`)
pnpm test:smoke   # builds the image and exercises the container (needs Docker)
pnpm typecheck
pnpm build && pnpm start
```
