import { resolve } from 'node:path'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, newPasswordSchema } from '../shared/api.js'
import { createAuthentication } from './auth/authentication.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { openDatabase, type SqliteDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations, appliedVersions } from './persistence/migrations.js'
import { restoreSnapshot, writeSnapshot } from './persistence/snapshot.js'
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
  reset-password [new]    Replace the User password and revoke every session.
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
 * Operational commands over the mounted volume — the emergency-recovery shape
 * in `docs/ARCHITECTURE.md`: no HTTP surface, no Session. Returns the exit
 * code so tests can drive it without spawning.
 */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  const [command, ...rest] = argv

  if (!command || command === 'help' || command === '--help') {
    context.out(USAGE)
    return command ? 0 : 1
  }

  // Opening the live path first would create an empty database exactly where
  // `restore` must refuse to find one and `backup` must find something real.
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
 * Persistence owns the snapshot mechanics. Failure messages are about files,
 * never about what the database holds.
 */
function backup(destination: string | undefined, context: CliContext): number {
  if (!destination) {
    context.out('backup needs a destination path for the snapshot')
    return 1
  }

  const target = resolve(destination)
  try {
    const { bytes } = writeSnapshot(context.config.databasePath, target)
    context.out(JSON.stringify({ backupCreated: true, destination: target, bytes }))
    return 0
  } catch (error) {
    context.out(`The backup failed and no snapshot was written: ${reasonOf(error)}`)
    return 1
  }
}

function restore(backupPath: string | undefined, context: CliContext): number {
  if (!backupPath) {
    context.out('restore needs the path to a backup snapshot')
    return 1
  }

  try {
    const report = restoreSnapshot(resolve(backupPath), context.config.databasePath, context.clock)
    context.out(JSON.stringify(report))
    return 0
  } catch (error) {
    context.out(`The restore failed and the live database path was not touched: ${reasonOf(error)}`)
    return 1
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Asks for no current password — whoever runs this holds the volume — but
 * revokes every Session, so an intruder who provoked the reset keeps nothing.
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
    // Audit output goes to stderr: stdout is this command's result channel,
    // and a log line interleaved with the JSON report would break piping to `jq`.
    logger: context.logger ?? createLogger({ level: context.config.logLevel, stream: process.stderr }),
    setupSecret: context.config.setupSecret,
  })

  const revoked = await authentication.resetPassword(password)
  context.out(JSON.stringify({ passwordReset: true, sessionsRevoked: revoked }))
  return 0
}
