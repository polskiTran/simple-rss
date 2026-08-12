import { MAX_PASSWORD_BYTES } from '../../shared/api.js'
import { hash, verify, type Algorithm } from '@node-rs/argon2'

// `Algorithm.Argon2id` as its value: the binding's ambient `const enum` cannot be imported
// under `verbatimModuleSyntax`. A test holds stored verifiers to `$argon2id$`, so a wrong
// number here could not go unnoticed.
const ARGON2ID = 2 as Algorithm

/** Everything that touches a password goes through here, so the algorithm lives in exactly one place. */
export interface PasswordHasher {
  /** The encoded verifier to store. Never the password. */
  hash(password: string): Promise<string>
  /** Constant-time as far as the algorithm allows; false for any bad input. */
  verify(storedHash: string, password: string): Promise<boolean>
}

/**
 * OWASP's second recommended Argon2id configuration. Memory-hard parameters are
 * what make an offline attack on a stolen volume expensive.
 */
export const ARGON2ID_PARAMETERS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Long inputs cost proportionally more to hash, so the length bound keeps a login from
 * spending the installation's CPU. The HTTP boundary rejects first; this is the backstop.
 */
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
        // A verifier the algorithm cannot parse is corrupt or foreign: a failed verification, not a crash.
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
