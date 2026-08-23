import { eq, sql } from 'drizzle-orm'
import type { DrizzleDatabase } from './database.js'
import { installationSettings } from './schema.js'

const SINGLETON_ID = 1

export interface InstallationSettings {
  /** IANA zone that defines the User's Digest calendar groups. */
  readonly timezone: string
  readonly createdAt: string
  readonly updatedAt: string
}

export class InstallationSettingsStore {
  readonly #db: DrizzleDatabase

  constructor(db: DrizzleDatabase) {
    this.#db = db
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

  /** An installation that never chose a zone reads as UTC. */
  effectiveTimezone(): string {
    return this.read()?.timezone ?? 'UTC'
  }

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

export class UnknownTimezoneError extends Error {
  constructor(timezone: string) {
    super(`Unknown installation timezone: ${timezone}`)
    this.name = 'UnknownTimezoneError'
  }
}

function assertResolvableTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new UnknownTimezoneError(timezone)
  }
}
