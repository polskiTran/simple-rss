import { createHash, randomBytes } from 'node:crypto'
import { and, eq, lte, or, sql } from 'drizzle-orm'
import type { DrizzleDatabase } from '../persistence/database.js'
import { sessions, userAuth } from '../persistence/schema.js'

/** A session dies this long after the device last used it. */
export const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

/** A session dies this long after it was created, however active it stays. */
export const ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000

const TOUCH_INTERVAL_MS = 60_000

const TOKEN_BYTES = 32

const SINGLETON_ID = 1

type Transaction = Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0]

export interface IssuedSession {
  /** Sent to the device once, in the cookie, and never stored. */
  readonly token: string
  /** The absolute deadline, for the cookie's own lifetime. */
  readonly expiresAt: Date
}

export type VerifierChangeOutcome =
  /** `revoked` counts the sessions signed out, and is legitimately `0`. */
  | { readonly kind: 'changed'; readonly revoked: number }
  /** The current password no longer matches the stored verifier: nothing was written. */
  | { readonly kind: 'stale-verifier' }

/**
 * The User's password verifier (`user_auth`) and their Sessions (`sessions`).
 *
 * One invariant spans both tables: a Session exists only under the current
 * verifier. Every operation here keeps it inside one transaction — a Session is
 * issued only while the verifier the caller checked is still stored, and
 * replacing the verifier revokes every Session — so a sign-in racing a password
 * change or reset can never leave a Session behind under the old password.
 */
export class CredentialStore {
  readonly #db: DrizzleDatabase

  constructor(db: DrizzleDatabase) {
    this.#db = db
  }

  /** The encoded Argon2id verifier, or `undefined` while the installation is unclaimed. */
  passwordHash(): string | undefined {
    const [row] = this.#db
      .select({ passwordHash: userAuth.passwordHash })
      .from(userAuth)
      .where(eq(userAuth.id, SINGLETON_ID))
      .limit(1)
      .all()

    return row?.passwordHash
  }

  /** Stores the first verifier and issues the claiming device's Session; `undefined` when already claimed. */
  claim(passwordHash: string, now: Date): IssuedSession | undefined {
    const at = now.toISOString()

    return this.#db.transaction((tx) => {
      const claimed = tx
        .insert(userAuth)
        .values({ id: SINGLETON_ID, passwordHash, claimedAt: at, updatedAt: at })
        .onConflictDoNothing({ target: userAuth.id })
        .run()

      return claimed.changes === 1 ? insertSession(tx, now) : undefined
    })
  }

  /** Issues a Session for a verified password; `undefined` if that verifier was replaced meanwhile. */
  issueSession(passwordHash: string, now: Date): IssuedSession | undefined {
    return this.#db.transaction((tx) => {
      const [current] = tx
        .select({ passwordHash: userAuth.passwordHash })
        .from(userAuth)
        .where(eq(userAuth.id, SINGLETON_ID))
        .all()

      return current?.passwordHash === passwordHash ? insertSession(tx, now) : undefined
    })
  }

  /** Whether the token names a live Session, sliding its idle deadline if so. */
  touch(token: string, now: Date): boolean {
    const tokenHash = fingerprint(token)

    const [row] = this.#db
      .select({ lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1)
      .all()

    if (!row) return false

    if (row.expiresAt <= now.toISOString() || row.lastSeenAt <= isoAgo(now, IDLE_TIMEOUT_MS)) {
      this.#db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run()
      return false
    }

    if (row.lastSeenAt <= isoAgo(now, TOUCH_INTERVAL_MS)) {
      this.#db.update(sessions).set({ lastSeenAt: now.toISOString() }).where(eq(sessions.tokenHash, tokenHash)).run()
    }

    return true
  }

  /** Ends one device's Session. Unknown tokens are already revoked. */
  revoke(token: string): void {
    this.#db
      .delete(sessions)
      .where(eq(sessions.tokenHash, fingerprint(token)))
      .run()
  }

  /** Removes Sessions past either deadline. Returns how many were swept. */
  prune(now: Date): number {
    return this.#db
      .delete(sessions)
      .where(or(lte(sessions.expiresAt, now.toISOString()), lte(sessions.lastSeenAt, isoAgo(now, IDLE_TIMEOUT_MS))))
      .run().changes
  }

  /** Replaces the verifier the caller checked and revokes every Session; refuses if it was replaced meanwhile. */
  changePassword(expectedHash: string, passwordHash: string, now: Date): VerifierChangeOutcome {
    return this.#db.transaction((tx): VerifierChangeOutcome => {
      const changed = tx
        .update(userAuth)
        .set({ passwordHash, updatedAt: now.toISOString() })
        .where(and(eq(userAuth.id, SINGLETON_ID), eq(userAuth.passwordHash, expectedHash)))
        .run()

      if (changed.changes !== 1) return { kind: 'stale-verifier' }
      return { kind: 'changed', revoked: tx.delete(sessions).run().changes }
    })
  }

  /** Installs an emergency verifier, claiming if need be, and revokes every Session. Returns how many it ended. */
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

function insertSession(tx: Transaction, now: Date): IssuedSession {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS)

  tx.insert(sessions)
    .values({
      tokenHash: fingerprint(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run()

  return { token, expiresAt }
}

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function isoAgo(now: Date, milliseconds: number): string {
  return new Date(now.getTime() - milliseconds).toISOString()
}
