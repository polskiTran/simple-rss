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

/**
 * An IANA zone name as a request carries it. Whether the runtime can actually
 * resolve it is the server's question, not a shape the schema can state.
 */
const timezoneNameSchema = z.string().min(1).max(100)

export const claimRequestSchema = z.object({
  setupSecret: z.string().min(1).max(1024),
  password: newPasswordSchema,
  /**
   * The claiming browser's own zone, offered so the installation timezone is
   * detected during setup rather than defaulting to UTC. Optional: a claim
   * must never fail over a calendar preference.
   */
  timezone: timezoneNameSchema.optional(),
})
export type ClaimRequest = z.infer<typeof claimRequestSchema>

/**
 * The Owner-editable installation preferences behind the Settings sheet. One
 * timezone for the whole installation, so the Digest's calendar groups agree
 * across the Owner's devices.
 */
export const installationPreferencesSchema = z.object({
  timezone: z.string(),
})
export type InstallationPreferences = z.infer<typeof installationPreferencesSchema>

export const updateTimezoneRequestSchema = z.object({
  timezone: timezoneNameSchema,
})
export type UpdateTimezoneRequest = z.infer<typeof updateTimezoneRequestSchema>

export const signInRequestSchema = z.object({
  password: presentedPasswordSchema,
})
export type SignInRequest = z.infer<typeof signInRequestSchema>

export const passwordChangeRequestSchema = z.object({
  currentPassword: presentedPasswordSchema,
  newPassword: newPasswordSchema,
})
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>

/**
 * The Polling Interval presets, in minutes. A Subscription is only ever one of
 * these; there is no free-form schedule to tune or to get wrong.
 */
export const POLLING_INTERVAL_PRESETS = [30, 60, 120, 360, 720, 1440] as const
export type PollingIntervalMinutes = (typeof POLLING_INTERVAL_PRESETS)[number]

export const DEFAULT_POLLING_INTERVAL_MINUTES: PollingIntervalMinutes = 120

export const pollingIntervalMinutesSchema = z.union([
  z.literal(30),
  z.literal(60),
  z.literal(120),
  z.literal(360),
  z.literal(720),
  z.literal(1440),
])

export const updatePollingIntervalRequestSchema = z.object({
  pollingIntervalMinutes: pollingIntervalMinutesSchema,
})
export type UpdatePollingIntervalRequest = z.infer<typeof updatePollingIntervalRequestSchema>

/** One Subscription's schedule: its preset and when it next becomes due. */
export const pollingScheduleSchema = z.object({
  pollingIntervalMinutes: pollingIntervalMinutesSchema,
  nextPollAt: z.string(),
})
export type PollingSchedule = z.infer<typeof pollingScheduleSchema>

const positiveIdParameterSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger)

export const feedIdParameterSchema = positiveIdParameterSchema
export const feedItemIdParameterSchema = positiveIdParameterSchema

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

/** Consecutive failures before Feed Availability is surfaced to the Owner. */
export const FEED_UNAVAILABLE_AFTER_FAILURES = 3

/**
 * The safe vocabulary for why a poll failed. Categories are deliberately
 * coarse: enough to tell a timeout from an oversized Feed from a publisher
 * error, never enough to carry a URL, a header, or response content.
 */
export const feedAvailabilityCategorySchema = z.enum([
  'unreachable',
  'timeout',
  'too_large',
  'unsupported_content',
  'http_error',
  'invalid_feed',
])
export type FeedAvailabilityCategory = z.infer<typeof feedAvailabilityCategorySchema>

/**
 * A calm summary of a Subscription's recent retrieval outcome. `unavailable`
 * begins at `FEED_UNAVAILABLE_AFTER_FAILURES` failures in a row; a quiet Feed
 * that simply publishes nothing stays `available`.
 */
export const feedAvailabilitySchema = z.object({
  state: z.enum(['available', 'unavailable']),
  lastCheckedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  category: feedAvailabilityCategorySchema.nullable(),
})
export type FeedAvailability = z.infer<typeof feedAvailabilitySchema>

export const subscriptionSummarySchema = feedSummarySchema.extend({
  /** Daily item counts, oldest to newest, in the installation timezone. */
  cadence: z.array(z.number().int().nonnegative()).length(30),
  availability: feedAvailabilitySchema,
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

/** How much history the opened Feed's cadence grid draws, in week columns. */
export const CADENCE_GRID_WEEKS = 26

/** One observed day of a Feed's publishing rhythm, in the installation timezone. */
export const cadenceObservationSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
})
export type CadenceObservation = z.infer<typeof cadenceObservationSchema>

/**
 * One retained Feed Item inside its own Feed, where the source label would be
 * redundant. `date` is the installation-timezone day the cadence grid jumps
 * to; `displayDate` is the same day said the way the meta row says it.
 */
export const feedItemRowSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  date: z.string(),
  displayDate: z.string(),
  saved: z.boolean(),
})
export type FeedItemRow = z.infer<typeof feedItemRowSchema>

/**
 * One opened Feed: identity, retained Feed Items, the cadence observations
 * behind the grid, and the polling behaviour the Owner manages there.
 * `cadence` runs oldest to newest from the first day of the grid window
 * through today, so a fixed dataset always draws the same grid.
 */
export const feedDetailSchema = feedSummarySchema.extend({
  availability: feedAvailabilitySchema,
  schedule: pollingScheduleSchema,
  cadence: z.array(cadenceObservationSchema),
  items: z.array(feedItemRowSchema),
})
export type FeedDetail = z.infer<typeof feedDetailSchema>

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
  saved: z.boolean(),
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

/**
 * One Feed Item the Owner explicitly saved, carrying its Feed attribution so
 * a save outlives the Digest and, later, the Subscription itself. `displayDate`
 * is the day said the way the meta row says it, like an opened Feed's items.
 */
export const libraryItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  /** False once the Feed was unsubscribed; the save and attribution remain. */
  subscribed: z.boolean(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  savedAt: z.string(),
  displayDate: z.string(),
})
export type LibraryItem = z.infer<typeof libraryItemSchema>

export const librarySchema = z.object({
  items: z.array(libraryItemSchema),
})
export type Library = z.infer<typeof librarySchema>

/** How long a browser may keep a successful Reader extraction, privately. */
export const READER_CACHE_SECONDS = 86_400

/** The Feed Item that follows in Digest order, so reading never dead-ends. */
export const readerNextSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedTitle: z.string(),
  displayTime: z.string(),
})
export type ReaderNext = z.infer<typeof readerNextSchema>

/**
 * One Feed Item as the Reader's header and fallback need it. Kept apart from
 * the extracted article, which the browser may cache for a day: membership
 * and what comes next must always be the server's current answer.
 */
export const readerItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  /** The day said the way the Reader header says it: `tuesday, 5 august`. */
  displayDate: z.string(),
  summary: z.string().nullable(),
  saved: z.boolean(),
  nextInDigest: readerNextSchema.nullable(),
})
export type ReaderItem = z.infer<typeof readerItemSchema>

/**
 * A temporary Reader rendering. Markdown generated by the server's allowlist,
 * never stored — losing it costs one re-extraction, never the Feed Item.
 */
export const readerArticleSchema = z.object({
  feedItemId: z.number().int().positive(),
  markdown: z.string(),
  readingTimeMinutes: z.number().int().positive(),
})
export type ReaderArticle = z.infer<typeof readerArticleSchema>

/**
 * Whether one Feed Item is in the Library — what both mutations answer, so a
 * repeated save and an unsave of the already-unsaved describe the same state
 * instead of an error.
 */
export const libraryMembershipSchema = z.object({
  feedItemId: z.number().int().positive(),
  saved: z.boolean(),
  savedAt: z.string().nullable(),
})
export type LibraryMembership = z.infer<typeof libraryMembershipSchema>

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
