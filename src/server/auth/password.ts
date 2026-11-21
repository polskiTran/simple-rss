import { fitsPasswordBytes } from '../../shared/api.js'
import { hash, verify, type Algorithm } from '@node-rs/argon2'

const ARGON2ID: Algorithm = 2

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(storedHash: string, password: string): Promise<boolean>
}

export const ARGON2ID_PARAMETERS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export function argon2idHasher(): PasswordHasher {
  const options = { ...ARGON2ID_PARAMETERS, algorithm: ARGON2ID }

  return {
    async hash(password) {
      assertHashable(password)
      return hash(password, options)
    },

    async verify(storedHash, password) {
      if (!fitsPasswordBytes(password)) return false
      try {
        return await verify(storedHash, password)
      } catch {
        return false
      }
    },
  }
}

function assertHashable(password: string): void {
  if (!fitsPasswordBytes(password)) {
    throw new Error('Password is too long to hash')
  }
}
