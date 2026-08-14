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
| `SETUP_SECRET` | — | The one-time secret that lets the first visitor become the User. **Required until the installation is claimed**; ignored afterwards. At least 16 characters. |
| `PUBLIC_ORIGIN` | — | **Required.** The canonical HTTP or HTTPS origin the User uses, e.g. `https://reader.up.railway.app`. Outbound retrieval refuses this origin so a Feed or Feed Item link cannot point the installation back at its own API. |
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

## Released images

Releases are public, versioned, immutable `linux/amd64` images:

```
ghcr.io/polskitran/simple-rss:<version>    e.g. ghcr.io/polskitran/simple-rss:0.1.0
```

There is deliberately **no `latest` tag** — an installation names an explicit
version, and nothing ever updates it automatically. A published version is
never overwritten; the release workflow refuses to push a tag that already
exists.

A release is cut by pushing a Git tag `v<version>` matching `package.json`
and `src/shared/version.ts`. The workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)) runs the
release smoke test — deploy, claim, persist state, back up, replace the
container, restore onto a fresh volume — against the exact image it then
publishes, then confirms the published version pulls anonymously — the GHCR
package's public visibility is a one-time package setting, and the release
fails loudly until it is set. Pulling never needs registry credentials.

## Building the image

Deployments pull the released image; building is for development and for
cutting releases. The released image targets `linux/amd64`:

```sh
docker build --platform linux/amd64 -t simple-rss:$(node -p "require('./package.json').version") .
```

The Dockerfile itself is architecture-neutral — building without `--platform`
produces an image for the host, which is what local development wants. Building
`linux/amd64` on an arm64 machine needs qemu binfmt registered
(`docker run --privileged --rm tonistiigi/binfmt --install amd64`); CI builds it
natively on an amd64 runner instead.

## Running it anywhere Docker runs

These are the generic instructions; no Railway API is involved. The platform
injects `PORT`, mounts something durable at `/app/data`, supplies the setup
secret and the public origin, points health checks at the endpoints above, and
stops the container with `SIGTERM`:

```sh
docker run -d \
  --name simple-rss \
  -p 8080:8080 \
  -v simple-rss-data:/app/data \
  -e SETUP_SECRET="$(openssl rand -base64 32)" \
  -e PUBLIC_ORIGIN="https://reader.example.com" \
  ghcr.io/polskitran/simple-rss:0.1.0
```

The container runs as the unprivileged `node` user, writes structured JSON logs
to stdout, and stops gracefully on `SIGTERM` (allow at least
`SHUTDOWN_GRACE_MS` before force-killing). A host that mounts a volume the
`node` user cannot write to has to run the container as one that can — see
[The volume](#the-volume). Backups are the CLI snapshot command below — never a
raw copy of the live database file.

## Railway

The supported shape is in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#supported-railway-shape):
one Hobby-plan service, one replica, sleep disabled, restart policy `Always`,
and one volume mounted at `/app/data`.

### The template

The template provisions exactly one service and one volume — no Postgres, no
Redis, no queue, no second service of any kind:

| Setting | Value |
|---|---|
| Source | `ghcr.io/polskitran/simple-rss:<version>` — an explicit version, never `latest` |
| Replicas | 1 — SQLite on the volume constrains the service to a single instance |
| Resources | 1 vCPU limit, 1 GB memory limit |
| Volume | mounted at `/app/data` |
| Serverless | **disabled** — a sleeping service would stop background Feed polling |
| Restart policy | `Always` |
| Health check | `/health/ready` |
| `SETUP_SECRET` | `${{ secret(32) }}` — generated per deployment by the template, never a shared or hard-coded value |
| `PUBLIC_ORIGIN` | `https://${{ RAILWAY_PUBLIC_DOMAIN }}` |
| `RAILWAY_RUN_UID` | `0` — required by the volume, below |

Railway bills actual usage, not the configured limits; this workload is
expected to stay near the Hobby plan's minimum, and the 1 GB limit is
headroom rather than a reservation. Session secrets need no configuration at
all — session tokens are generated at sign-in and only their hashes are
stored.

There is no `railway.json` in the repository on purpose: config-as-code
applies to services Railway builds from a connected repo, while this template
deploys the published image, so the settings above live in the template
itself.

### The volume

Railway attaches no volume on its own, and volumes are not expressible in
config-as-code either — the template provisions one, and a service built by
hand has to be given one explicitly:

```sh
railway variable set RAILWAY_RUN_UID=0 --service <service> --skip-deploys
railway volume add --mount-path /app/data
```

Without a volume the service still runs: `/app/data` resolves to the
container's writable layer, so the database survives restarts and disappears
with every deploy, taking the User's claim, Subscriptions, and reading history
with it. The symptom is an upgraded installation asking to be claimed again.

`RAILWAY_RUN_UID=0` is not optional. Railway mounts the volume owned by `root`
and the mount replaces the image's `node`-owned `/app/data`, so the image's own
`USER node` can no longer write there; the container must run as a uid that
can. Without it the process starts and readiness stays closed on the write
probe.

Attaching the volume redeploys the service, and that deploy is the last one to
discard the previous container's data — so take anything worth keeping off the
service first.

### Rescuing data from a service with no volume

Everything durable is inside the container and there is no volume to download
from, so the snapshot leaves over SSH. Take it with the CLI rather than copying
the live database, and carry the hash across so a mangled transfer cannot pass
for a backup:

```sh
railway ssh -- sh -c 'node dist/server/cli-main.js backup /tmp/snapshot.db && sha256sum /tmp/snapshot.db'
railway ssh -- sh -c 'gzip -9 -c /tmp/snapshot.db | base64 -w0' 2>/dev/null \
  | base64 -d | gunzip > snapshot.db
sha256sum snapshot.db   # must equal what the container reported
```

Then attach the volume as above and restore onto it. `restore` refuses to run
where a database already exists, and the deploy that mounted the empty volume
created one, so remove it first — the running process holds its handle on the
unlinked file until the redeploy, which is what makes it read the restored
database:

```sh
railway volume files -v <volume> upload ./snapshot.db /backups/snapshot.db
railway ssh -- sh -c 'rm -f /app/data/simple-rss.db /app/data/simple-rss.db-wal /app/data/simple-rss.db-shm'
railway ssh -- node dist/server/cli-main.js restore /app/data/backups/snapshot.db
railway redeploy -y
```

The restore reports what it recovered and rebuilds the search index; confirm
`/health/ready` afterwards. Sessions come across, so signed-in devices stay
signed in.

### First deployment and claim

1. Deploy the template. Railway generates an HTTPS domain
   (`https://<service>.up.railway.app`) that works immediately — no custom
   DNS is required, and `PUBLIC_ORIGIN` already points at it.
2. The deployment becomes healthy only after startup migrations complete and
   the readiness check passes. Railway mounts the volume only at runtime, so
   migrations run during application startup rather than as a pre-deploy
   command — that is why readiness, not liveness, is the gate that holds
   traffic back.
3. Open the domain and claim the installation: the setup secret is in the
   service's variables, and the claim screen wants it once, together with the
   User's chosen password. Setup then closes permanently.

State lives on the volume, so a redeploy — same version or an upgrade — keeps
the User's claim, sessions, Subscriptions, and reading history.

### Custom domain (optional)

The generated domain is fully supported; a custom domain changes nothing
structural:

1. Add the domain to the service in Railway and follow its DNS instructions.
2. Update `PUBLIC_ORIGIN` to the new origin (e.g. `https://reader.example.com`)
   and redeploy, so outbound retrieval refuses Feed URLs pointing back at the
   installation's own new address.

Everything else already behaves: the session cookie is host-only
(`Secure; SameSite=Strict`), so the User simply signs in once on the new
domain; the same-origin check compares each request against its own host, the
CSP is `'self'`-relative, and the health endpoints are unchanged.

### Deploys and downtime

One replica and one volume mean each deploy has a brief downtime while the
volume detaches from the old container and attaches to the new one. That is a
deliberate trade for a personal reader — see
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#single-instance-consequences).
Persisted polling schedules catch the scheduler up after the gap.

### Watching it run

- **Logs** — structured JSON on stdout, in Railway's log view. `LOG_LEVEL`
  raises or lowers the detail.
- **Health** — point Railway's health check at `/health/ready`. Liveness
  staying green while readiness fails means the process is up but refusing
  traffic for a stated reason (failed migration, full volume); the reason is
  in the readiness response and the logs.
- **Volume usage** — visible in Railway's volume metrics. A full volume closes
  readiness rather than corrupting writes; growth is bounded by Retention
  plus whatever the Library keeps.
- **Backups** — Railway's daily volume backups are on by default and are the
  baseline safety net. Take an explicit CLI backup (below) before anything
  deliberate, and download it off the volume if it should survive the volume
  itself.

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
cannot make a second User afterwards, so it can be left in place or removed.

Sessions are cookies holding an opaque random token whose hash alone is stored.
A device stays signed in for seven days of inactivity and at most thirty days
in total; a phone and a laptop hold independent sessions. Signing out ends that
one device's session, while changing the password ends all of them.

### Losing the password

There is no recovery email, no OAuth, no security question, and no second
User. Recovery is a shell command on the volume:

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

Settings offers two downloads, both for the signed-in User only:

- **`subscriptions (OPML)`** — the active Subscriptions as an OPML 2.0
  document any other reader imports.
- **`everything (JSON)`** — the complete portable reading state: Subscriptions
  and Polling Intervals, Feed metadata, retained Feed Items, Library
  membership, the installation timezone, and the export and schema versions.
  It never contains the password verifier, sessions, the setup secret,
  retrieval caches, or any other operational state, so the file is safe to
  keep anywhere the User keeps documents.

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
# 3. Start (or restart) the service and confirm readiness before using it:
curl -fsS "$PUBLIC_ORIGIN/health/ready"
```

Readiness is the gate, not just a check: with the platform's readiness probe
pointed at `/health/ready` (see [Health checks](#health-checks)), traffic is
held back until the restored volume passes startup migrations and the write
probe. The `curl` is the operator's own confirmation of the same answer.

The command verifies the snapshot's integrity, applies any migrations a newer
build ships, rebuilds the derived search index from the restored Feed Items,
and proves the directory is writable — all against a staging copy that only
replaces `simple-rss.db` after every check passed. A failed restore leaves the
data directory uninitialized and the service unready, and says why.

A restored installation preserves Subscriptions and their Polling Intervals,
retained Feed Items, Library membership, installation settings, and User
access — the same password signs in, because the User's verifier lives in the
database. What a backup does not carry is anything derived or in flight:
Reader renderings and proxied images are re-fetched on demand, and Feed Items
published between the backup and the restore arrive with the next poll.

## Upgrading

Installations never follow a mutable `latest` tag, and nothing updates
automatically. Upgrading is deliberate:

1. Take a backup (above).
2. Pick an explicit image version — `ghcr.io/polskitran/simple-rss:0.2.0`,
   never `latest` — and replace the container while retaining the volume. On
   Railway that means editing the service's image reference and redeploying;
   the volume moves to the new container, with the brief downtime described
   above. Retaining the volume is what preserves state, and the release smoke
   test covers exactly that path.
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
