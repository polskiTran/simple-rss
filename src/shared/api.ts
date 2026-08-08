import { z } from 'zod'

/**
 * The contract between the client and the server. Both sides import these
 * schemas, so a route and its caller cannot drift apart silently.
 */

export const livenessSchema = z.object({
  status: z.literal('live'),
})
export type Liveness = z.infer<typeof livenessSchema>

export const readinessSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }),
  z.object({ status: z.literal('unready'), reason: z.string() }),
])
export type Readiness = z.infer<typeof readinessSchema>

/**
 * Deliberately free of Owner data: it answers "which build is running" for
 * upgrades and smoke tests, and nothing else.
 */
export const serviceMetaSchema = z.object({
  name: z.literal('simple-rss'),
  version: z.string(),
})
export type ServiceMeta = z.infer<typeof serviceMetaSchema>

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})
export type ApiError = z.infer<typeof apiErrorSchema>

/**
 * The shortest password the Owner may choose. There is one Owner and no
 * password reset by email, so length is the whole policy: no character
 * classes, no expiry, nothing that pushes someone toward a worse password
 * they will write down.
 */
export const MIN_PASSWORD_LENGTH = 12

/** Bounded because every candidate is hashed with a memory-hard function. */
export const MAX_PASSWORD_LENGTH = 512

export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)

/**
 * Deliberately looser than `newPasswordSchema`. Validating a presented
 * password against the policy would answer "that is not even the right shape"
 * — a free filter for anyone guessing. Every wrong password gets one answer.
 */
const presentedPasswordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH)

/**
 * What the client needs to decide between the setup screen, the login screen,
 * and the reader. Says nothing else about the installation.
 */
export const authStatusSchema = z.object({
  claimed: z.boolean(),
  authenticated: z.boolean(),
})
export type AuthStatus = z.infer<typeof authStatusSchema>

export const claimRequestSchema = z.object({
  setupSecret: z.string().min(1).max(1024),
  password: newPasswordSchema,
})
export type ClaimRequest = z.infer<typeof claimRequestSchema>

export const signInRequestSchema = z.object({
  password: presentedPasswordSchema,
})
export type SignInRequest = z.infer<typeof signInRequestSchema>

export const passwordChangeRequestSchema = z.object({
  currentPassword: presentedPasswordSchema,
  newPassword: newPasswordSchema,
})
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>
