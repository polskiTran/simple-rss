# One image, one process: the Hono API, the built React client, and SQLite on a
# mounted volume. Published for linux/amd64; see docs/DEPLOYMENT.md.
#
# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.22.1

# ---------------------------------------------------------------------------
# Dependencies. Separated so a source-only change reuses the install layer.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 falls back to compiling from source when no prebuilt binary
# matches the platform, which needs a toolchain and Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Build. Produces dist/client (Vite) and dist/server (tsc).
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN pnpm build

# Drops dev dependencies from the tree that ships.
RUN pnpm prune --prod

# ---------------------------------------------------------------------------
# Runtime. No compiler, no package manager, no sources.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    CLIENT_DIR=/app/dist/client \
    PORT=8080

# The volume mounts here. Owned by `node` so the unprivileged user can write.
RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 8080
VOLUME ["/app/data"]

# No init shim: the server installs its own SIGTERM handler and is PID 1 on
# purpose, so the platform's stop signal reaches it directly.
CMD ["node", "dist/server/main.js"]
