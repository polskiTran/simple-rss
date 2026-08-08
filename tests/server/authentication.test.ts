import { describe, expect, it } from 'vitest'
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS } from '../../src/server/auth/sessions.js'
import { SESSION_COOKIE } from '../../src/server/http/session-cookie.js'
import { apiErrorSchema, authStatusSchema } from '../../src/shared/api.js'
import { claimedDevice, Device } from '../support/device.js'
import { OWNER_PASSWORD, SETUP_SECRET, startTestService, type TestService } from '../support/service-harness.js'

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** The session rows on the volume, for assertions HTTP cannot make. */
function storedSessions(service: TestService): Array<{ token_hash: string }> {
  return service.database!.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>
}

function storedVerifier(service: TestService): string | undefined {
  const rows = service.database!.prepare('SELECT password_hash FROM owner_auth').all() as Array<{
    password_hash: string
  }>
  return rows.length === 1 ? rows[0]?.password_hash : undefined
}

async function status(response: Response) {
  return authStatusSchema.parse(await response.json())
}

async function errorCode(response: Response) {
  return apiErrorSchema.parse(await response.json()).error.code
}

/**
 * Guessing spread across enough addresses to reach the installation-wide
 * ceiling, while leaving each one below its own limit.
 */
async function saturateTheCeiling(service: TestService): Promise<void> {
  for (let host = 1; host <= 5; host += 1) {
    const guesser = new Device(service, { address: `203.0.113.${host}` })
    for (let attempt = 0; attempt < 4; attempt += 1) await guesser.signIn('a-wrong-password')
  }
}

describe('an unclaimed installation', () => {
  it('answers the health checks, which is how the platform sees it at all', async () => {
    const service = await startTestService()

    expect((await service.fetch('/health/live')).status).toBe(200)
    expect((await service.fetch('/health/ready')).status).toBe(200)
  })

  it('says it is unclaimed, so the client knows to offer setup', async () => {
    const service = await startTestService()

    expect(await status(await new Device(service).status())).toEqual({ claimed: false, authenticated: false })
  })

  it('closes every other API route to an unknown visitor', async () => {
    const service = await startTestService()

    const response = await new Device(service).get('/api/meta')

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('unauthenticated')
  })

  it('cannot be signed in to, and does not say why', async () => {
    const service = await startTestService()

    const response = await new Device(service).signIn()

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('invalid_credentials')
  })

  it('stays unready while no setup secret is configured, rather than serving a dead end', async () => {
    const service = await startTestService({ env: { SETUP_SECRET: '' } })

    const response = await service.fetch('/health/ready')

    expect(response.status).toBe(503)
    expect((await response.json()).reason).toBe('setup secret is not configured')
  })

  it('stays unready when the configured setup secret is too short to protect anything', async () => {
    const service = await startTestService({ env: { SETUP_SECRET: 'hunter2' } })

    const response = await service.fetch('/health/ready')

    expect(response.status).toBe(503)
    expect((await response.json()).reason).toBe('setup secret is too short')
  })

  it('refuses to be claimed while its setup secret is unusable', async () => {
    const service = await startTestService({ env: { SETUP_SECRET: '' } })

    const response = await new Device(service).claim(OWNER_PASSWORD, 'any-secret-at-all')

    expect(response.status).toBe(503)
    expect(await errorCode(response)).toBe('setup_unavailable')
  })
})

describe('claiming an installation', () => {
  it('requires the deployment setup secret', async () => {
    const service = await startTestService()

    const response = await new Device(service).claim(OWNER_PASSWORD, 'not-the-setup-secret')

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('invalid_credentials')
    expect(storedVerifier(service)).toBeUndefined()
  })

  it('signs the claiming device in', async () => {
    const service = await startTestService()

    const response = await new Device(service).claim()

    expect(response.status).toBe(201)
    expect(await status(response)).toEqual({ claimed: true, authenticated: true })
  })

  it('stores one Argon2id verifier and never the password', async () => {
    const service = await startTestService()

    await new Device(service).claim()

    expect(storedVerifier(service)).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(storedVerifier(service)).not.toContain(OWNER_PASSWORD)
  })

  it('refuses a password too short to be the only thing protecting the installation', async () => {
    const service = await startTestService()

    const response = await new Device(service).claim('short')

    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe('invalid_request')
    expect(storedVerifier(service)).toBeUndefined()
  })

  it('disables setup permanently, so the secret cannot make a second Owner', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const response = await new Device(service).claim('a-second-owner-password')

    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('already_claimed')
  })

  it('leaves the original password working after a refused second claim', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    await new Device(service).claim('a-second-owner-password')

    const returning = new Device(service)

    expect((await returning.signIn(OWNER_PASSWORD)).status).toBe(200)
    expect((await new Device(service).signIn('a-second-owner-password')).status).toBe(401)
  })

  it('makes exactly one Owner when two devices claim it at the same instant', async () => {
    const service = await startTestService()
    const first = new Device(service)
    const second = new Device(service)

    const responses = await Promise.all([first.claim('the-first-password'), second.claim('the-second-password')])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const winner = responses[0].status === 201 ? 'the-first-password' : 'the-second-password'
    const loser = responses[0].status === 201 ? 'the-second-password' : 'the-first-password'
    expect((await new Device(service).signIn(winner)).status).toBe(200)
    expect((await new Device(service).signIn(loser)).status).toBe(401)
  })

  it('opens readiness on a claimed installation whose setup secret has been removed', async () => {
    const first = await startTestService()
    await claimedDevice(first)
    await first.stop()

    const second = await startTestService({ dataDir: first.dataDir, env: { SETUP_SECRET: '' } })

    expect((await second.fetch('/health/ready')).status).toBe(200)
  })
})

describe('returning to a claimed installation', () => {
  it('signs the Owner in with the password', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const response = await new Device(service).signIn()

    expect(response.status).toBe(200)
    expect(await status(response)).toEqual({ claimed: true, authenticated: true })
  })

  it('opens the rest of the API once signed in', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    expect((await owner.get('/api/meta')).status).toBe(200)
  })

  it('answers a wrong password generically, and says nothing about the Owner', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const response = await new Device(service).signIn('the-wrong-password')
    const body = await response.text()

    expect(response.status).toBe(401)
    expect(JSON.parse(body).error.code).toBe('invalid_credentials')
    expect(body).not.toMatch(/owner|password verifier|argon/i)
  })

  it('sends the token in an HttpOnly, Secure, same-site cookie', async () => {
    const service = await startTestService()

    const response = await new Device(service).claim()
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`))

    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(cookie).toMatch(/Path=\//i)
  })

  it('stores only a hash of the token, so a copy of the volume grants nothing', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const stored = storedSessions(service)

    expect(stored).toHaveLength(1)
    expect(owner.sessionToken).toBeDefined()
    expect(stored[0]?.token_hash).not.toBe(owner.sessionToken)
    expect(JSON.stringify(stored)).not.toContain(owner.sessionToken)
  })

  it('issues an opaque token that carries no readable claim', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    expect(owner.sessionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(owner.sessionToken).not.toContain('.')
  })

  it('refuses a token that was never issued', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const impostor = new Device(service).present('a-token-nobody-issued')

    expect((await impostor.get('/api/meta')).status).toBe(401)
  })

  it('survives replacing the container, because the session is on the volume', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    await service.restart()

    expect((await owner.get('/api/meta')).status).toBe(200)
  })
})

describe('a phone and a laptop', () => {
  it('hold independent sessions', async () => {
    const service = await startTestService()
    const laptop = await claimedDevice(service)
    const phone = new Device(service)
    await phone.signIn()

    expect(phone.sessionToken).not.toBe(laptop.sessionToken)
    expect((await phone.get('/api/meta')).status).toBe(200)
    expect((await laptop.get('/api/meta')).status).toBe(200)
  })

  it('are unaffected by each other signing out', async () => {
    const service = await startTestService()
    const laptop = await claimedDevice(service)
    const phone = new Device(service)
    await phone.signIn()

    await phone.signOut()

    expect((await phone.get('/api/meta')).status).toBe(401)
    expect((await laptop.get('/api/meta')).status).toBe(200)
  })

  it('both lose access when the password changes', async () => {
    const service = await startTestService()
    const laptop = await claimedDevice(service)
    const phone = new Device(service)
    await phone.signIn()

    await laptop.changePassword(OWNER_PASSWORD, 'a-replacement-password')

    expect((await phone.get('/api/meta')).status).toBe(401)
    expect((await laptop.get('/api/meta')).status).toBe(401)
    expect(storedSessions(service)).toHaveLength(0)
  })
})

describe('signing out', () => {
  it('clears the cookie and revokes only that session', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const response = await owner.signOut()

    expect(response.status).toBe(204)
    expect(owner.sessionToken).toBeUndefined()
    expect(storedSessions(service)).toHaveLength(0)
  })

  it('succeeds for a device that holds no session', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    expect((await new Device(service).signOut()).status).toBe(204)
  })
})

describe('changing the password', () => {
  it('needs the current password as well as a session', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const response = await owner.changePassword('not-the-current-one', 'a-replacement-password')

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('invalid_credentials')
    expect((await owner.get('/api/meta')).status).toBe(200)
  })

  it('is closed to a caller with no session at all', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const response = await new Device(service).changePassword(OWNER_PASSWORD, 'a-replacement-password')

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('unauthenticated')
  })

  it('reports that the Owner must sign in again', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const response = await owner.changePassword(OWNER_PASSWORD, 'a-replacement-password')

    expect(response.status).toBe(200)
    expect(await status(response)).toEqual({ claimed: true, authenticated: false })
    expect(owner.sessionToken).toBeUndefined()
  })

  it('replaces the password rather than adding one', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)
    await owner.changePassword(OWNER_PASSWORD, 'a-replacement-password')

    expect((await new Device(service).signIn('a-replacement-password')).status).toBe(200)
    expect((await new Device(service).signIn(OWNER_PASSWORD)).status).toBe(401)
  })

  it('refuses a replacement that is too short', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const response = await owner.changePassword(OWNER_PASSWORD, 'short')

    expect(response.status).toBe(400)
    expect((await new Device(service).signIn(OWNER_PASSWORD)).status).toBe(200)
  })
})

describe('a session that has been left alone', () => {
  it('stays alive while the device keeps using it', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    for (let day = 0; day < 4; day += 1) {
      service.clock.advance(6 * DAY_MS)
      expect((await owner.get('/api/meta')).status).toBe(200)
    }
  })

  it('idles out after seven untouched days', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    service.clock.advance(IDLE_TIMEOUT_MS - MINUTE_MS)
    expect((await owner.get('/api/meta')).status).toBe(200)

    service.clock.advance(IDLE_TIMEOUT_MS)
    expect((await owner.get('/api/meta')).status).toBe(401)
  })

  it('forgets an idled-out session rather than leaving the row behind', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    service.clock.advance(IDLE_TIMEOUT_MS)
    await owner.get('/api/meta')

    expect(storedSessions(service)).toHaveLength(0)
  })

  it('expires thirty days after it was issued, however often it is used', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    for (let elapsed = 6 * DAY_MS; elapsed < ABSOLUTE_TIMEOUT_MS; elapsed += 6 * DAY_MS) {
      service.clock.advance(6 * DAY_MS)
      expect((await owner.get('/api/meta')).status).toBe(200)
    }

    service.clock.advance(6 * DAY_MS)
    expect((await owner.get('/api/meta')).status).toBe(401)
  })

  it('lets the Owner sign in again afterwards', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)
    service.clock.advance(ABSOLUTE_TIMEOUT_MS)
    await owner.get('/api/meta')

    expect((await new Device(service).signIn()).status).toBe(200)
  })
})

describe('resisting password guessing', () => {
  it('allows five wrong passwords from one address before refusing more', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    const guesser = new Device(service, { address: '203.0.113.7' })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await guesser.signIn('a-wrong-password')).status).toBe(401)
    }

    const sixth = await guesser.signIn('a-wrong-password')
    expect(sixth.status).toBe(429)
    expect(await errorCode(sixth)).toBe('too_many_attempts')
  })

  it('makes each wrong password cost more time than the last', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    const guesser = new Device(service, { address: '203.0.113.7' })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await guesser.signIn('a-wrong-password')
    }

    expect(service.sleeps).toEqual([250, 500, 1000, 2000])
  })

  it('says how long to wait, and never locks the Owner out for good', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    const guesser = new Device(service, { address: '203.0.113.7' })
    for (let attempt = 0; attempt < 6; attempt += 1) await guesser.signIn('a-wrong-password')

    const blocked = await guesser.signIn(OWNER_PASSWORD)
    const retryAfter = Number(blocked.headers.get('retry-after'))
    service.clock.advance(retryAfter * 1000 + MINUTE_MS)

    expect(blocked.status).toBe(429)
    expect(retryAfter).toBeGreaterThan(0)
    expect((await guesser.signIn(OWNER_PASSWORD)).status).toBe(200)
  })

  it('forgets a client that proves itself, so a typo does not follow the Owner around', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    const owner = new Device(service, { address: '203.0.113.7' })
    for (let attempt = 0; attempt < 4; attempt += 1) await owner.signIn('a-wrong-password')

    await owner.signIn(OWNER_PASSWORD)
    await owner.signOut()
    await owner.signIn('a-wrong-password')

    expect(service.sleeps.at(-1)).toBe(250)
  })

  it('slows every address down once the whole installation is under attack', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    await saturateTheCeiling(service)

    const fresh = new Device(service, { address: '198.51.100.9' })
    await fresh.signIn('a-wrong-password')

    expect(service.sleeps.at(-1)).toBe(2000)
  })

  it('still lets the Owner in from a clean address, so nobody can lock them out', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    await saturateTheCeiling(service)

    const owner = new Device(service, { address: '198.51.100.9' })

    expect((await owner.signIn(OWNER_PASSWORD)).status).toBe(200)
  })

  it('costs a wrong setup secret the same as a wrong password', async () => {
    const service = await startTestService()
    const guesser = new Device(service, { address: '203.0.113.7' })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await guesser.claim(OWNER_PASSWORD, 'not-the-setup-secret')).status).toBe(401)
    }

    expect((await guesser.claim(OWNER_PASSWORD, 'not-the-setup-secret')).status).toBe(429)
  })

  it('costs a wrong current password the same when changing it', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service, { address: '203.0.113.7' })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await owner.changePassword('not-the-current-one', 'a-replacement-password')
    }

    const blocked = await owner.changePassword('not-the-current-one', 'a-replacement-password')
    expect(blocked.status).toBe(429)
  })

  it('counts a forged forwarding header against the address that sent it', async () => {
    const service = await startTestService()
    await claimedDevice(service)
    // A caller appending its own entry cannot spend someone else's budget:
    // the proxy's entry is the rightmost one, and that is the one counted.
    const guesser = new Device(service, { address: '198.51.100.1, 203.0.113.7' })
    for (let attempt = 0; attempt < 5; attempt += 1) await guesser.signIn('a-wrong-password')

    const neighbour = new Device(service, { address: '198.51.100.1' })
    expect((await neighbour.signIn('a-wrong-password')).status).toBe(401)
  })
})

describe('cross-site request forgery', () => {
  it('refuses a state-changing request from another origin', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const forged = new Device(service, { origin: 'https://evil.example' })
    const response = await forged.signIn()

    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe('forbidden_origin')
  })

  it('refuses a state-changing request that names no origin at all', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    const response = await new Device(service, { origin: null }).signIn()

    expect(response.status).toBe(403)
  })

  it('refuses an opaque origin, which is what a sandboxed frame sends', async () => {
    const service = await startTestService()
    await claimedDevice(service)

    expect((await new Device(service, { origin: 'null' }).signIn()).status).toBe(403)
  })

  it('protects an authenticated mutation the same way', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)
    const forged = new Device(service, { origin: 'https://evil.example' }).present(owner.sessionToken)

    const response = await forged.changePassword(OWNER_PASSWORD, 'a-replacement-password')

    expect(response.status).toBe(403)
    expect((await owner.get('/api/meta')).status).toBe(200)
  })

  it('enables no credentialed cross-origin access', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    const preflight = await service.fetch('/api/auth/session', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    const authenticated = await owner.get('/api/meta')

    for (const response of [preflight, authenticated]) {
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(response.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })
})

describe('what authentication reveals', () => {
  it('sends the standard hardening headers on authentication responses', async () => {
    const service = await startTestService()

    const response = await new Device(service).signIn()

    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d+/)
  })

  it('keeps authentication responses out of every cache', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)

    for (const response of [await owner.status(), await new Device(service).signIn('wrong-password-here')]) {
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('writes no password, setup secret, or session token to the log', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)
    await new Device(service).signIn('a-wrong-password')
    await owner.changePassword(OWNER_PASSWORD, 'a-replacement-password')

    const written = JSON.stringify(service.logs)

    expect(written).not.toContain(OWNER_PASSWORD)
    expect(written).not.toContain(SETUP_SECRET)
    expect(written).not.toContain('a-replacement-password')
    expect(written).not.toContain(owner.sessionToken ?? 'a-token-that-was-never-issued')
  })

  it('records the authentication events an Owner would want to see', async () => {
    const service = await startTestService()
    const owner = await claimedDevice(service)
    await new Device(service).signIn('a-wrong-password')
    await owner.signOut()

    const messages = service.logs.map((record) => record.message)

    expect(messages).toContain('auth.claimed')
    expect(messages).toContain('auth.sign_in_rejected')
    expect(messages).toContain('auth.signed_out')
  })

  it('rejects a body that is not JSON without failing the request as a crash', async () => {
    const service = await startTestService()

    const response = await service.fetch('/api/auth/session', {
      method: 'POST',
      headers: { origin: new URL(service.url).origin, 'content-type': 'application/json' },
      body: 'not json at all',
    })

    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe('invalid_request')
  })
})
