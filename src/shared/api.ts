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

/** Bound the work handed to Argon2 after UTF-8 encoding. */
export const MAX_PASSWORD_BYTES = 1024
export const MAX_PASSWORD_LENGTH = 512

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH)
  .refine((password) => utf8ByteLength(password) <= MAX_PASSWORD_BYTES, {
    message: `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
  })

/**
 * Deliberately looser than `newPasswordSchema`. Validating a presented
 * password against the creation policy would reveal more than a generic
 * credential failure, but the same resource bounds still apply.
 */
const presentedPasswordSchema = z
  .string()
  .min(1)
  .max(MAX_PASSWORD_LENGTH)
  .refine((password) => utf8ByteLength(password) <= MAX_PASSWORD_BYTES)

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

export const feedIdParameterSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger)

/** Exact Feed endpoint submitted by the Owner; discovery is deliberately absent. */
export const createSubscriptionRequestSchema = z.object({
  url: z.string().min(1).max(2_048),
})
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>

/** The largest OPML upload one import accepts, in UTF-16 code units. */
export const MAX_OPML_LENGTH = 1_048_576

/** One uploaded OPML document, carried as text inside the usual JSON body. */
export const importOpmlRequestSchema = z.object({
  opml: z.string().min(1).max(MAX_OPML_LENGTH),
})
export type ImportOpmlRequest = z.infer<typeof importOpmlRequestSchema>

/**
 * What happened to one Feed the OPML listed. `reason` explains a skip or a
 * failure in the Owner's terms; an added Feed needs none.
 */
export const opmlImportFeedSchema = z.object({
  url: z.string(),
  outcome: z.enum(['added', 'skipped', 'failed']),
  title: z.string().nullable(),
  reason: z.string().nullable(),
})
export type OpmlImportFeed = z.infer<typeof opmlImportFeedSchema>

export const opmlImportReportSchema = z.object({
  feeds: z.array(opmlImportFeedSchema),
})
export type OpmlImportReport = z.infer<typeof opmlImportReportSchema>

export const feedSummarySchema = z.object({
  feedId: z.number().int().positive(),
  title: z.string(),
  domain: z.string(),
  enteredUrl: z.string(),
  resolvedUrl: z.string(),
})
export type FeedSummary = z.infer<typeof feedSummarySchema>

export const subscriptionSummarySchema = feedSummarySchema.extend({
  /** Daily item counts, oldest to newest, in the installation timezone. */
  cadence: z.array(z.number().int().nonnegative()).length(30),
})
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>

export const createSubscriptionResponseSchema = z.object({
  subscription: subscriptionSummarySchema,
  importedItems: z.number().int().nonnegative(),
})
export type CreateSubscriptionResponse = z.infer<typeof createSubscriptionResponseSchema>

export const subscriptionListSchema = z.object({
  subscriptions: z.array(subscriptionSummarySchema),
})
export type SubscriptionList = z.infer<typeof subscriptionListSchema>

export const refreshFeedResponseSchema = z.object({
  observedItems: z.number().int().nonnegative(),
})
export type RefreshFeedResponse = z.infer<typeof refreshFeedResponseSchema>

export const digestItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  displayTime: z.string(),
  imageUrl: z.string().nullable(),
  summary: z.string().nullable(),
  firstSeenAt: z.string(),
})
export type DigestItem = z.infer<typeof digestItemSchema>

export const digestGroupSchema = z.object({
  date: z.string(),
  label: z.string(),
  items: z.array(digestItemSchema),
})
export type DigestGroup = z.infer<typeof digestGroupSchema>

export const digestSchema = z.object({
  today: z.object({
    date: z.string(),
    volume: z.number().int().nonnegative(),
  }),
  groups: z.array(digestGroupSchema),
})
export type Digest = z.infer<typeof digestSchema>

/** `Buffer` is unavailable in the browser half of this shared boundary. */
function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      bytes += 1
    } else if (codeUnit <= 0x7ff) {
      bytes += 2
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}
