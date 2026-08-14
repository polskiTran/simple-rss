import { describe, expect, it } from 'vitest'
import { ARGON2ID_PARAMETERS, argon2idHasher } from '../../../src/server/auth/password.js'

describe('the password hasher', () => {
  it('produces an Argon2id verifier with the documented parameters', async () => {
    const stored = await argon2idHasher().hash('a-calm-reading-password')

    expect(stored).toMatch(
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${ARGON2ID_PARAMETERS.memoryCost},` +
          `t=${ARGON2ID_PARAMETERS.timeCost},p=${ARGON2ID_PARAMETERS.parallelism}\\$`,
      ),
    )
  })

  it('accepts the password it was given', async () => {
    const hasher = argon2idHasher()
    const stored = await hasher.hash('a-calm-reading-password')

    expect(await hasher.verify(stored, 'a-calm-reading-password')).toBe(true)
  })

  it('rejects every other password, including a near miss', async () => {
    const hasher = argon2idHasher()
    const stored = await hasher.hash('a-calm-reading-password')

    expect(await hasher.verify(stored, 'a-calm-reading-passwore')).toBe(false)
    expect(await hasher.verify(stored, 'a-calm-reading-password ')).toBe(false)
    expect(await hasher.verify(stored, '')).toBe(false)
  })

  it('salts each verifier, so two identical passwords do not look alike', async () => {
    const hasher = argon2idHasher()

    const [first, second] = await Promise.all([hasher.hash('the-same-password'), hasher.hash('the-same-password')])

    expect(first).not.toBe(second)
  })

  it('treats an unreadable stored verifier as a failed check, not a crash', async () => {
    const hasher = argon2idHasher()

    expect(await hasher.verify('', 'a-calm-reading-password')).toBe(false)
    expect(await hasher.verify('not-a-verifier', 'a-calm-reading-password')).toBe(false)
    expect(await hasher.verify('$argon2id$v=19$m=19456,t=2,p=1$truncated', 'x')).toBe(false)
  })

  it('refuses a password long enough to be a way of spending the installation', async () => {
    const hasher = argon2idHasher()
    const enormous = 'x'.repeat(64 * 1024)

    await expect(hasher.hash(enormous)).rejects.toThrow(/too long/i)
    expect(await hasher.verify(await hasher.hash('a-calm-reading-password'), enormous)).toBe(false)
  })
})
