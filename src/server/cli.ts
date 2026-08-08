import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, newPasswordSchema } from '../shared/api.js'
import { createAuthentication } from './auth/authentication.js'
import type { Clock } from './clock.js'
import type { Config } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { openDatabase, type SqliteDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations, appliedVersions } from './persistence/migrations.js'

const USAGE = `simple-rss <command>

  migrate                 Apply pending schema migrations and exit
  show                    Print the installation settings as JSON
  set-timezone <iana>     Set the installation timezone, e.g. Europe/Berlin
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
