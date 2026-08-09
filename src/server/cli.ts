import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, newPasswordSchema } from '../shared/api.js'
import { createAuthentication } from './auth/authentication.js'
import { OwnerAuthStore } from './auth/owner-auth.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { assertWritable, openDatabase, type SqliteDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations, appliedVersions } from './persistence/migrations.js'
import { rebuildSearchIndex } from './search/search-service.js'

const USAGE = `simple-rss <command>

  migrate                 Apply pending schema migrations and exit
  show                    Print the installation settings as JSON
  set-timezone <iana>     Set the installation timezone, e.g. Europe/Berlin
  rebuild-search          Rebuild the derived search index from retained Feed Items
  backup <destination>    Write an application-consistent snapshot of the live
                          database to <destination>. Never overwrites.
  restore <backup>        Initialize an empty data directory from a snapshot:
                          verify it, migrate it, and rebuild the search index.
  reset-password [new]    Replace the Owner password and revoke every session.
                          Reads SIMPLE_RSS_NEW_PASSWORD when given no argument,
                          which keeps the password out of the shell history.
`

/** Where `reset-password` looks when it is not handed the password directly. */
export const NEW_PASSWORD_VARIABLE = 'SIMPLE_RSS_NEW_PASSWORD'

export interface CliContext {
  readonly config: Config
  readonly clock: Clock
  readonly out: (line: string) => void
  /** The process environment, so a reset can take the password from it. */
  readonly env?: NodeJS.ProcessEnv
  readonly logger?: Logger
}

/**
 * Operational commands run through the platform shell — the shape
 * `docs/ARCHITECTURE.md` gives emergency recovery: no HTTP surface, no
 * session, just the mounted volume.
 *
 * Returns the process exit code so tests can drive it without spawning.
 */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === 'help' || command === '--help') {
    context.out(USAGE)
    return command ? 0 : 1
  }

  // The snapshot commands manage database files themselves. Opening the live
  // path first would create an empty database exactly where `restore` must
  // refuse to find one and where `backup` must find something real.
  if (command === 'backup') return backup(rest[0], context)
  if (command === 'restore') return restore(rest[0], context)

  const db = openDatabase(context.config.databasePath)
  try {
    switch (command) {
      case 'migrate': {
        const applied = applyMigrations(db, context.clock)
        context.out(JSON.stringify({ applied, versions: appliedVersions(db) }))
        return 0
      }
      case 'show': {
        context.out(JSON.stringify(new InstallationSettingsStore(db).read() ?? null))
        return 0
      }
      case 'set-timezone': {
        const timezone = rest[0]
        if (!timezone) {
          context.out('set-timezone needs an IANA timezone, e.g. Europe/Berlin')
          return 1
        }
        applyMigrations(db, context.clock)
        const store = new InstallationSettingsStore(db)
        store.setTimezone(timezone, context.clock.now())
        context.out(JSON.stringify(store.read()))
        return 0
      }
      case 'rebuild-search': {
        applyMigrations(db, context.clock)
        const indexedItems = rebuildSearchIndex(db)
        context.out(JSON.stringify({ searchIndexRebuilt: true, indexedItems }))
        return 0
      }
      case 'reset-password': {
        return await resetPassword(db, rest[0], context)
      }
      default: {
        context.out(`Unknown command: ${command}\n\n${USAGE}`)
        return 1
      }
    }
  } finally {
    db.close()
  }
}

/**
 * Writes an application-consistent snapshot of the live database. `VACUUM
 * INTO` produces a compacted, transaction-consistent copy even while the WAL
 * is active, which is what makes this safe where a raw file copy of an open
 * database is not.
 *
 * The snapshot is written under a partial name and renamed only once
 * complete, so a failure can never leave an artifact that looks like a
 * finished backup — and an existing file is never overwritten, because the
 * backup an operator is replacing is the one they need if this run fails.
 */
function backup(destination: string | undefined, context: CliContext): number {
  if (!destination) {
    context.out('backup needs a destination path for the snapshot')
    return 1
  }

  const source = context.config.databasePath
  if (!existsSync(source)) {
    context.out(`There is no database at ${source} to back up`)
    return 1
  }

  const target = resolve(destination)
  if (existsSync(target)) {
    context.out(`${target} already exists; back up to a new path instead of overwriting one`)
    return 1
  }

  const partial = `${target}.partial`
  try {
    mkdirSync(dirname(target), { recursive: true })
    rmSync(partial, { force: true })

    const db = openDatabase(source)
    try {
      db.prepare('VACUUM INTO ?').run(partial)
    } finally {
      db.close()
    }

    renameSync(partial, target)
  } catch (error) {
    rmSync(partial, { force: true })
    context.out(`The backup failed and no snapshot was written: ${reasonOf(error)}`)
    return 1
  }

  context.out(JSON.stringify({ backupCreated: true, destination: target, bytes: statSync(target).size }))
  return 0
}

/**
 * Initializes an empty data directory from a snapshot. All verification —
 * integrity, migrations, the derived search rebuild, a real write — happens
 * on a staging copy that is renamed into place only after everything passed,
 * so a failed restore leaves the directory uninitialized and the service
 * unready rather than serving half a database.
 *
 * Migrations run here so a backup taken on an older release comes forward to
 * the schema this build serves; the FTS index is rebuilt rather than trusted,
 * because derived state is this installation's to derive.
 */
function restore(backupPath: string | undefined, context: CliContext): number {
  if (!backupPath) {
    context.out('restore needs the path to a backup snapshot')
    return 1
  }

  const source = resolve(backupPath)
  if (!existsSync(source)) {
    context.out(`There is no backup at ${source}`)
    return 1
  }

  const target = context.config.databasePath
  if (existsSync(target)) {
    context.out(`${target} already exists; restore only initializes a fresh data directory`)
    return 1
  }

  const staging = `${target}.restoring`
  const stagingFiles = [staging, `${staging}-wal`, `${staging}-shm`]
  let report: string
  try {
    mkdirSync(dirname(target), { recursive: true })
    for (const leftover of stagingFiles) rmSync(leftover, { force: true })
    copyFileSync(source, staging)

    const db = openDatabase(staging)
    try {
      if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('the snapshot failed its integrity check')
      }
      const migrationsApplied = applyMigrations(db, context.clock)
      const indexedItems = rebuildSearchIndex(db)
      assertWritable(db, context.clock.now())

      report = JSON.stringify({
        restored: true,
        migrationsApplied,
        indexedItems,
        feeds: countRows(db, 'feeds'),
        subscriptions: countRows(db, 'subscriptions'),
        feedItems: countRows(db, 'feed_items'),
        libraryItems: countRows(db, 'library_items'),
        claimed: new OwnerAuthStore(db).isClaimed(),
      })
    } finally {
      db.close()
    }

    renameSync(staging, target)
  } catch (error) {
    for (const leftover of stagingFiles) rmSync(leftover, { force: true })
    context.out(`The restore failed and the data directory was left uninitialized: ${reasonOf(error)}`)
    return 1
  }

  context.out(report)
  return 0
}

function countRows(db: SqliteDatabase, table: 'feeds' | 'subscriptions' | 'feed_items' | 'library_items'): number {
  return (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The recovery path an installation with one Owner and no identity provider
 * has to have. It asks for no current password, because whoever can run it
 * already holds the volume — but it does end every session, since an intruder
 * who provoked the reset must not keep the one they already have.
 */
async function resetPassword(
  db: SqliteDatabase,
  argument: string | undefined,
  context: CliContext,
): Promise<number> {
  const password = argument ?? context.env?.[NEW_PASSWORD_VARIABLE]

  if (!password) {
    context.out(`reset-password needs a new password, as an argument or in ${NEW_PASSWORD_VARIABLE}`)
    return 1
  }

  if (!newPasswordSchema.safeParse(password).success) {
    context.out(
      `The new password must be at least ${MIN_PASSWORD_LENGTH} characters and at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
    )
    return 1
  }

  applyMigrations(db, context.clock)

  const authentication = createAuthentication({
    database: db,
    clock: context.clock,
    // The audit record goes to stderr, unlike the server's, because stdout is
    // this command's result channel — an operator (or a test) pipes it into
    // `jq`, and a log line interleaved with the report would break that.
    logger: context.logger ?? createLogger({ level: context.config.logLevel, stream: process.stderr }),
    setupSecret: context.config.setupSecret,
  })

  const revoked = await authentication.resetPassword(password)
  context.out(JSON.stringify({ passwordReset: true, sessionsRevoked: revoked }))
  return 0
}
