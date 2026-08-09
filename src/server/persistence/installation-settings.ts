import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import type { SqliteDatabase } from './database.js'
import { installationSettings } from './schema.js'

/** The one row's fixed identity — this installation belongs to one Owner. */
const SINGLETON_ID = 1

export interface InstallationSettings {
  /** IANA zone that defines the Owner's Digest calendar groups. */
  readonly timezone: string
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Reads and writes the singleton installation row.
 *
 * Later tickets add the Owner's other preferences here; the shape that matters
 * now is that state lives on the mounted volume and survives the process.
 */
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

  /**
   * The zone every calendar grouping uses. An installation that never chose
   * one — claimed before detection existed, or by a browser that offered
   * nothing — reads as UTC, which is how its days were grouped all along.
   */
  effectiveTimezone(): string {
    return this.read()?.timezone ?? 'UTC'
  }

  /**
   * Seeds or updates the installation timezone. `createdAt` is written once so
   * the age of an installation stays meaningful across later edits.
   */
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

/**
 * Typed so a route can refuse the zone itself as a bad request while letting
 * any other failure — a full volume, a closed handle — surface as what it is.
 */
export class UnknownTimezoneError extends Error {
  constructor(timezone: string) {
    super(`Unknown installation timezone: ${timezone}`)
    this.name = 'UnknownTimezoneError'
  }
}

/**
 * A timezone the runtime cannot resolve would silently break every Digest
 * grouping, so it is rejected at the point of entry rather than at read time.
 */
function assertResolvableTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new UnknownTimezoneError(timezone)
  }
}
