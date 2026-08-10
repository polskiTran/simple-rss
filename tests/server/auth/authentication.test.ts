import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Authentication } from '../../../src/server/auth/authentication.js'
import { UserAuthStore } from '../../../src/server/auth/user-auth.js'
import type { PasswordHasher } from '../../../src/server/auth/password.js'
import { LoginRateLimiter } from '../../../src/server/auth/rate-limit.js'
import { SessionStore } from '../../../src/server/auth/sessions.js'
import { createLogger } from '../../../src/server/logger.js'
import { openDatabase, type SqliteDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations } from '../../../src/server/persistence/migrations.js'
import { ManualClock } from '../../support/manual-clock.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

describe('credential rotation races', () => {
  let database: SqliteDatabase | undefined

  afterEach(() => database?.close())

  it('does not issue a session after the verifier that accepted it was reset', async () => {
    const dataDir = await makeTempDataDir()
    database = openDatabase(join(dataDir, 'simple-rss.db'))
    const clock = new ManualClock('2026-08-08T09:00:00.000Z')
    applyMigrations(database, clock)

    const user = new UserAuthStore(database)
    const sessions = new SessionStore(database)
    user.claim('hash:old-password', clock.now())

    let verificationStarted!: () => void
    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve
    })
    let finishVerification!: () => void
    const held = new Promise<void>((resolve) => {
      finishVerification = resolve
    })
    const hasher: PasswordHasher = {
      hash: async (password) => `hash:${password}`,
      verify: async (storedHash, password) => {
        verificationStarted()
        await held
        return storedHash === `hash:${password}`
      },
    }
    const authentication = new Authentication({
      user,
      sessions,
      hasher,
      limiter: new LoginRateLimiter(clock),
      sleep: async () => {},
      clock,
      logger: createLogger({ level: 'error', sink: () => {} }),
      setupSecret: 'a-long-enough-setup-secret',
    })

    const staleSignIn = authentication.signIn({ client: '203.0.113.7', password: 'old-password' })
    await started
    await authentication.resetPassword('new-password')
    finishVerification()

    expect(await staleSignIn).toEqual({ kind: 'rejected' })
    expect(user.read()?.passwordHash).toBe('hash:new-password')
  })
})
