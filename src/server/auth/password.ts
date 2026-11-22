import { fitsPasswordBytes } from '../../shared/api.js'
import { hash, verify } from '@node-rs/argon2'

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
  return {
    async hash(password) {
      assertHashable(password)
      return hash(password, ARGON2ID_PARAMETERS)
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
