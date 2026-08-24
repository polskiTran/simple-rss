import { MAX_PASSWORD_BYTES } from '../../shared/api.js'
import { hash, verify, type Algorithm } from '@node-rs/argon2'

// `2` is `Algorithm.Argon2id`: the binding's ambient `const enum` cannot be
// imported under `verbatimModuleSyntax`.
const ARGON2ID: Algorithm = 2

export interface PasswordHasher {
  /** The encoded verifier to store. Never the password. */
  hash(password: string): Promise<string>
  /** Constant-time as far as the algorithm allows; false for any bad input. */
  verify(storedHash: string, password: string): Promise<boolean>
}

/** OWASP's second recommended Argon2id configuration. */
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
      if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) return false
      try {
        return await verify(storedHash, password)
      } catch {
        return false
      }
    },
  }
}

function assertHashable(password: string): void {
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new Error('Password is too long to hash')
  }
}
