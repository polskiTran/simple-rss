import { createHash, randomBytes } from 'node:crypto'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, lte, or } from 'drizzle-orm'
import type { SqliteDatabase } from '../persistence/database.js'
import { userAuth, sessions } from '../persistence/schema.js'

/** A session dies this long after the device last used it. */
export const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

/** A session dies this long after it was created, however active it stays. */
export const ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000

const TOUCH_INTERVAL_MS = 60_000

const TOKEN_BYTES = 32

export interface IssuedSession {
  /** Sent to the device once, in the cookie, and never stored. */
  readonly token: string
  /** The absolute deadline, for the cookie's own lifetime. */
  readonly expiresAt: Date
}

export class SessionStore {
  readonly #db: BetterSQLite3Database

  constructor(db: SqliteDatabase) {
    this.#db = drizzle(db)
  }

  issueForPasswordHash(passwordHash: string, now: Date): IssuedSession | undefined {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS)

    return this.#db.transaction((tx) => {
      const [current] = tx
        .select({ passwordHash: userAuth.passwordHash })
        .from(userAuth)
        .limit(1)
        .all()

      if (current?.passwordHash !== passwordHash) return undefined

      tx.insert(sessions)
        .values({
          tokenHash: fingerprint(token),
          createdAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        })
        .run()

      return { token, expiresAt }
    })
  }

  /** Whether the token names a live session, sliding its idle deadline if so. */
  touch(token: string, now: Date): boolean {
    const tokenHash = fingerprint(token)

    const [row] = this.#db
      .select({ lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1)
      .all()

    if (!row) return false

    if (row.expiresAt <= now.toISOString() || row.lastSeenAt <= idleCutoff(now)) {
      this.#db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run()
      return false
    }

    if (row.lastSeenAt <= isoAgo(now, TOUCH_INTERVAL_MS)) {
      this.#db
        .update(sessions)
        .set({ lastSeenAt: now.toISOString() })
        .where(eq(sessions.tokenHash, tokenHash))
        .run()
    }

    return true
  }

  /** Ends one device's session. Unknown tokens are already revoked. */
  revoke(token: string): void {
    this.#db.delete(sessions).where(eq(sessions.tokenHash, fingerprint(token))).run()
  }

  /** Removes sessions past either deadline. Returns how many were swept. */
  prune(now: Date): number {
    return this.#db
      .delete(sessions)
      .where(or(lte(sessions.expiresAt, now.toISOString()), lte(sessions.lastSeenAt, idleCutoff(now))))
      .run().changes
  }

}

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function idleCutoff(now: Date): string {
  return isoAgo(now, IDLE_TIMEOUT_MS)
}

function isoAgo(now: Date, milliseconds: number): string {
  return new Date(now.getTime() - milliseconds).toISOString()
}
