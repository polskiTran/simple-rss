import { and, eq, sql } from 'drizzle-orm'
import type { DrizzleDatabase } from '../persistence/database.js'
import { userAuth, sessions } from '../persistence/schema.js'

const SINGLETON_ID = 1

export interface UserAuthRecord {
  /** The encoded Argon2id verifier. */
  readonly passwordHash: string
  readonly claimedAt: string
  readonly updatedAt: string
}

export type VerifierChangeOutcome =
  /** `revoked` counts the sessions signed out, and is legitimately `0`. */
  | { readonly kind: 'changed'; readonly revoked: number }
  /** The current password no longer matches the stored verifier: nothing was written. */
  | { readonly kind: 'stale-verifier' }

export class UserAuthStore {
  readonly #db: DrizzleDatabase

  constructor(db: DrizzleDatabase) {
    this.#db = db
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

  claim(passwordHash: string, now: Date): boolean {
    const at = now.toISOString()

    const result = this.#db
      .insert(userAuth)
      .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
      .onConflictDoNothing({ target: userAuth.id })
      .run()

    return result.changes === 1
  }

  /** Replaces the verified current password and revokes every session in one transaction. */
  changePassword(expectedHash: string, passwordHash: string, now: Date): VerifierChangeOutcome {
    const at = now.toISOString()

    return this.#db.transaction((tx): VerifierChangeOutcome => {
      const changed = tx
        .update(userAuth)
        .set({ passwordHash, updatedAt: at })
        .where(and(eq(userAuth.id, SINGLETON_ID), eq(userAuth.passwordHash, expectedHash)))
        .run()

      if (changed.changes !== 1) return { kind: 'stale-verifier' }
      return { kind: 'changed', revoked: tx.delete(sessions).run().changes }
    })
  }

  /** Installs an emergency verifier and revokes every session atomically. */
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
