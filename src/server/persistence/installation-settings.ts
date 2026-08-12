import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import type { SqliteDatabase } from './database.js'
import { installationSettings } from './schema.js'

/** An installation belongs to one User. */
const SINGLETON_ID = 1

export interface InstallationSettings {
  /** IANA zone that defines the User's Digest calendar groups. */
  readonly timezone: string
  readonly createdAt: string
  readonly updatedAt: string
}

export class InstallationSettingsStore {
  readonly #db: BetterSQLite3Database

  constructor(db: SqliteDatabase) {
    this.#db = drizzle(db)
  }

  read(): InstallationSettings | undefined {
    const [row] = this.#db
      .select({
        timezone: installationSettings.timezone,
        createdAt: installationSettings.createdAt,
        updatedAt: installationSettings.updatedAt,
      })
      .from(installationSettings)
      .where(eq(installationSettings.id, SINGLETON_ID))
      .limit(1)
      .all()

    return row
  }

  /** An installation that never chose a zone reads as UTC — how its days were grouped all along. */
  effectiveTimezone(): string {
    return this.read()?.timezone ?? 'UTC'
  }

  /** `createdAt` is written once, so the installation's age survives later edits. */
  setTimezone(timezone: string, now: Date): void {
    assertResolvableTimezone(timezone)
    const at = now.toISOString()

    this.#db
      .insert(installationSettings)
      .values({ id: SINGLETON_ID, timezone, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: installationSettings.id,
        set: { timezone: sql`excluded.timezone`, updatedAt: sql`excluded.updated_at` },
      })
      .run()
  }
}

/** Typed so a route can refuse the zone as a bad request while other failures surface as what they are. */
export class UnknownTimezoneError extends Error {
  constructor(timezone: string) {
    super(`Unknown installation timezone: ${timezone}`)
    this.name = 'UnknownTimezoneError'
  }
}

/** An unresolvable zone would silently break every Digest grouping, so reject at entry, not at read time. */
function assertResolvableTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new UnknownTimezoneError(timezone)
  }
}
