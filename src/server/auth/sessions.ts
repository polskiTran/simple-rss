import { createHash, randomBytes } from 'node:crypto'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq, lte, or } from 'drizzle-orm'
import type { SqliteDatabase } from '../persistence/database.js'
import { sessions } from '../persistence/schema.js'

/** A session dies this long after the device last used it. */
export const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

/** A session dies this long after it was created, however active it stays. */
export const ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Every request could push the idle deadline forward, but a write per request
 * buys nothing: the deadline is a week away. Sliding it at most once a minute
 * keeps reading a read.
 */
const TOUCH_INTERVAL_MS = 60_000

/** 256 bits of randomness, which is what makes the token unguessable. */
const TOKEN_BYTES = 32

export interface IssuedSession {
  /** Sent to the device once, in the cookie, and never stored. */
  readonly token: string
  /** The absolute deadline, for the cookie's own lifetime. */
  readonly expiresAt: Date
}

/**
 * The signed-in devices. Sessions are opaque random tokens rather than signed
 * claims, so revocation is real: deleting the row ends the session everywhere,
 * immediately, with nothing left to honour a stale signature.
 *
 * Only `sha256(token)` is stored. A copy of the volume — a backup, a support
 * dump, a stolen disk — therefore contains no usable cookie.
 */
export class SessionStore {
  readonly #db: BetterSQLite3Database

  constructor(db: SqliteDatabase) {
    this.#db = drizzle(db)
  }

  /** Creates a session for one device and returns the token it must present. */
  issue(now: Date): IssuedSession {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS)

    this.#db
      .insert(sessions)
      .values({
        tokenHash: fingerprint(token),
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      })
      .run()

    return { token, expiresAt }
  }

  /**
   * Whether the token names a live session, sliding its idle deadline if so.
   *
   * A session found past either deadline is deleted here rather than left for
   * the sweep, so the row cannot outlive the access it grants.
   */
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

  /**
   * Ends every session and reports how many there were. This is what a
   * password change and the emergency reset both mean.
   */
  revokeAll(): number {
    return this.#db.delete(sessions).run().changes
  }

  /** Removes sessions past either deadline. Returns how many were swept. */
  prune(now: Date): number {
    return this.#db
      .delete(sessions)
      .where(or(lte(sessions.expiresAt, now.toISOString()), lte(sessions.lastSeenAt, idleCutoff(now))))
      .run().changes
  }

}

/**
 * The stored identity of a token. A single SHA-256 is the right primitive
 * here, unlike for a password: the input is 256 random bits, so there is no
 * guessable space for a slow hash to protect.
 */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Sessions last seen at or before this instant have idled out. */
function idleCutoff(now: Date): string {
  return isoAgo(now, IDLE_TIMEOUT_MS)
}

function isoAgo(now: Date, milliseconds: number): string {
  return new Date(now.getTime() - milliseconds).toISOString()
}
