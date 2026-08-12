import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, eq, sql } from 'drizzle-orm'
import type { SqliteDatabase } from '../persistence/database.js'
import { userAuth, sessions } from '../persistence/schema.js'

/** An installation has exactly one User. */
const SINGLETON_ID = 1

export interface UserAuthRecord {
  /** The encoded Argon2id verifier. */
  readonly passwordHash: string
  readonly claimedAt: string
  readonly updatedAt: string
}

/** The row exists only after setup, so its existence answers whether the installation is claimed. */
export class UserAuthStore {
  readonly #db: BetterSQLite3Database

  constructor(db: SqliteDatabase) {
    this.#db = drizzle(db)
  }

  read(): UserAuthRecord | undefined {
    const [row] = this.#db
      .select({
        passwordHash: userAuth.passwordHash,
        claimedAt: userAuth.claimedAt,
        updatedAt: userAuth.updatedAt,
      })
      .from(userAuth)
      .where(eq(userAuth.id, SINGLETON_ID))
      .limit(1)
      .all()

    return row
  }

  isClaimed(): boolean {
    return this.read() !== undefined
  }

  /**
   * Two racing claims both finish hashing before either writes, so SQLite decides: the
   * insert creates the singleton row or does nothing, and exactly one caller is told it won.
   */
  claim(passwordHash: string, now: Date): boolean {
    const at = now.toISOString()

    const result = this.#db
      .insert(userAuth)
      .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
      .onConflictDoNothing({ target: userAuth.id })
      .run()

    return result.changes === 1
  }

  /**
   * Replaces the verified current password and revokes every session in one transaction.
   * A verifier rotated while Argon2 ran cannot be overwritten by the stale password.
   */
  changePassword(expectedHash: string, passwordHash: string, now: Date): number | undefined {
    const at = now.toISOString()

    return this.#db.transaction((tx) => {
      const changed = tx
        .update(userAuth)
        .set({ passwordHash, updatedAt: at })
        .where(and(eq(userAuth.id, SINGLETON_ID), eq(userAuth.passwordHash, expectedHash)))
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
      tx.insert(userAuth)
        .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: userAuth.id,
          set: { passwordHash: sql`excluded.password_hash`, updatedAt: sql`excluded.updated_at` },
        })
        .run()

      return tx.delete(sessions).run().changes
    })
  }
}
