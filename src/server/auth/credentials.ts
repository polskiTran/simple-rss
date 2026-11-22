import { createHash, randomBytes } from 'node:crypto'
import { and, eq, lte, or, sql } from 'drizzle-orm'
import type { DrizzleDatabase } from '../persistence/database.js'
import { sessions, userAuth } from '../persistence/schema.js'

export const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000

export const ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000

const TOUCH_INTERVAL_MS = 60_000

const TOKEN_BYTES = 32

const SINGLETON_ID = 1

type Transaction = Parameters<Parameters<DrizzleDatabase['transaction']>[0]>[0]

export interface IssuedSession {
  readonly token: string
  readonly expiresAt: Date
}

export type VerifierChangeOutcome =
  | { readonly kind: 'changed'; readonly revoked: number }
  | { readonly kind: 'stale-verifier' }

export class CredentialStore {
  readonly #db: DrizzleDatabase

  constructor(db: DrizzleDatabase) {
    this.#db = db
  }

  passwordHash(): string | undefined {
    const [row] = this.#db
      .select({ passwordHash: userAuth.passwordHash })
      .from(userAuth)
      .where(eq(userAuth.id, SINGLETON_ID))
      .limit(1)
      .all()

    return row?.passwordHash
  }

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

  authenticate(token: string, now: Date): boolean {
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

  revoke(token: string): void {
    this.#db
      .delete(sessions)
      .where(eq(sessions.tokenHash, fingerprint(token)))
      .run()
  }

  prune(now: Date): number {
    return this.#db
      .delete(sessions)
      .where(or(lte(sessions.expiresAt, now.toISOString()), lte(sessions.lastSeenAt, isoAgo(now, IDLE_TIMEOUT_MS))))
      .run().changes
  }

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
