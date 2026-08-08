import type { Clock } from './clock.js'
import type { Config } from './config.js'
import { openDatabase } from './persistence/database.js'
import { InstallationSettingsStore } from './persistence/installation-settings.js'
import { applyMigrations, appliedVersions } from './persistence/migrations.js'

const USAGE = `simple-rss <command>

  migrate                 Apply pending schema migrations and exit
  show                    Print the installation settings as JSON
  set-timezone <iana>     Set the installation timezone, e.g. Europe/Berlin
`

export interface CliContext {
  readonly config: Config
  readonly clock: Clock
  readonly out: (line: string) => void
}

/**
 * Operational commands run through the platform shell — the shape
 * `docs/ARCHITECTURE.md` gives emergency recovery: no HTTP surface, no
 * session, just the mounted volume.
 *
 * Returns the process exit code so tests can drive it without spawning.
 */
export function runCli(argv: readonly string[], context: CliContext): number {
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
      default: {
        context.out(`Unknown command: ${command}\n\n${USAGE}`)
        return 1
      }
    }
  } finally {
    db.close()
  }
}
