import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, eq, sql } from 'drizzle-orm'
import type { SqliteDatabase } from '../persistence/database.js'
import { ownerAuth, sessions } from '../persistence/schema.js'

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
   * Replaces a verified current password and revokes every session in the same
   * transaction. If another request or recovery command rotated the verifier
   * while Argon2 was running, the stale password cannot overwrite it.
   */
  changePassword(expectedHash: string, passwordHash: string, now: Date): number | undefined {
    const at = now.toISOString()

    return this.#db.transaction((tx) => {
      const changed = tx
        .update(ownerAuth)
        .set({ passwordHash, updatedAt: at })
        .where(and(eq(ownerAuth.id, SINGLETON_ID), eq(ownerAuth.passwordHash, expectedHash)))
        .run()

      if (changed.changes !== 1) return undefined
      return tx.delete(sessions).run().changes
    })
  }

  /**
   * Installs an emergency verifier and revokes every session atomically.
   * Recovery may also claim an installation whose setup secret was lost.
   */
  resetPassword(passwordHash: string, now: Date): number {
    const at = now.toISOString()

    return this.#db.transaction((tx) => {
      tx.insert(ownerAuth)
        .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: ownerAuth.id,
          set: { passwordHash: sql`excluded.password_hash`, updatedAt: sql`excluded.updated_at` },
        })
        .run()

      return tx.delete(sessions).run().changes
    })
  }
}
