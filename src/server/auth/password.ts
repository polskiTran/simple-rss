import { MAX_PASSWORD_BYTES } from '../../shared/api.js'
import { hash, verify, type Algorithm } from '@node-rs/argon2'

/**
 * `Algorithm.Argon2id`, written as its value.
 *
 * The binding's enum is an ambient `const enum`, which `verbatimModuleSyntax`
 * refuses to import as a value. The stored verifiers begin `$argon2id$`, and
 * a test holds them to that, so a wrong number here could not go unnoticed.
 */
const ARGON2ID = 2 as Algorithm

/**
 * How the Owner's password becomes a stored verifier, as a dependency rather
 * than a direct call. Everything that touches a password goes through this
 * interface, so the algorithm lives in exactly one place.
 */
export interface PasswordHasher {
  /** The encoded verifier to store. Never the password. */
  hash(password: string): Promise<string>
  /** Constant-time as far as the algorithm allows; false for any bad input. */
  verify(storedHash: string, password: string): Promise<boolean>
}

/**
 * OWASP's second recommended Argon2id configuration: 19 MiB of memory, two
 * passes, one lane. Memory-hard parameters are the point — they are what makes
 * an offline attack on a stolen volume expensive.
 */
export const ARGON2ID_PARAMETERS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Long inputs cost proportionally more to hash, so a bounded length keeps a
 * login attempt from becoming a way to spend the installation's CPU. The HTTP
 * boundary rejects these first; this is the backstop for every other caller.
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
        // A verifier the algorithm cannot parse is a corrupt or foreign value,
        // which is a failed verification rather than a request that crashed.
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
