import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import type { SqliteDatabase } from '../persistence/database.js'
import { ownerAuth } from '../persistence/schema.js'

/** The one row's fixed identity — an installation has exactly one Owner. */
const SINGLETON_ID = 1

export interface OwnerAuthRecord {
  /** The encoded Argon2id verifier. */
  readonly passwordHash: string
  readonly claimedAt: string
  readonly updatedAt: string
}

/**
 * The Owner's password verifier, and therefore the answer to whether this
 * installation has been claimed at all: the row exists only after setup.
 */
export class OwnerAuthStore {
  readonly #db: BetterSQLite3Database

  constructor(db: SqliteDatabase) {
    this.#db = drizzle(db)
  }

  read(): OwnerAuthRecord | undefined {
    const [row] = this.#db
      .select({
        passwordHash: ownerAuth.passwordHash,
        claimedAt: ownerAuth.claimedAt,
        updatedAt: ownerAuth.updatedAt,
      })
      .from(ownerAuth)
      .where(eq(ownerAuth.id, SINGLETON_ID))
      .limit(1)
      .all()

    return row
  }

  isClaimed(): boolean {
    return this.read() !== undefined
  }

  /**
   * Installs the first verifier, reporting whether this call is the one that
   * claimed the installation.
   *
   * Two requests can present a valid setup secret at the same time, and both
   * will have finished hashing before either writes. The decision is therefore
   * left to SQLite: the insert either creates the singleton row or does
   * nothing, so exactly one caller can ever be told it won.
   */
  claim(passwordHash: string, now: Date): boolean {
    const at = now.toISOString()

    const result = this.#db
      .insert(ownerAuth)
      .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
      .onConflictDoNothing({ target: ownerAuth.id })
      .run()

    return result.changes === 1
  }

  /**
   * Replaces the verifier, for a password change or the emergency reset.
   * Claims the installation when it was never claimed, so recovery works on an
   * installation whose setup secret was lost before it was ever used.
   *
   * The original claim time survives, because how long an installation has
   * existed should not change when its password does.
   */
  replacePassword(passwordHash: string, now: Date): void {
    const at = now.toISOString()

    this.#db
      .insert(ownerAuth)
      .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: ownerAuth.id,
        set: { passwordHash: sql`excluded.password_hash`, updatedAt: sql`excluded.updated_at` },
      })
      .run()
  }
}
