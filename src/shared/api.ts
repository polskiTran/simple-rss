import { z } from 'zod'

/**
 * The client/server contract. Both sides import these schemas, so a route and
 * its caller cannot drift apart silently.
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

// Deliberately free of User data: it answers "which build is running" and nothing else.
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

// Length is the whole policy: no character classes, no expiry, nothing that
// pushes someone toward a worse password they will write down.
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

// Deliberately looser than `newPasswordSchema`: validating against the
// creation policy would reveal it on login. The resource bounds still apply.
const presentedPasswordSchema = z
  .string()
  .min(1)
  .max(MAX_PASSWORD_LENGTH)
  .refine((password) => utf8ByteLength(password) <= MAX_PASSWORD_BYTES)

// Only what decides between setup, login, and the reader; nothing else about
// the installation.
export const authStatusSchema = z.object({
  claimed: z.boolean(),
  authenticated: z.boolean(),
})
export type AuthStatus = z.infer<typeof authStatusSchema>

// Shape only; whether the runtime can resolve the zone is the server's check.
const timezoneNameSchema = z.string().min(1).max(100)

export const claimRequestSchema = z.object({
  setupSecret: z.string().min(1).max(1024),
  password: newPasswordSchema,
  /** Optional: a claim must never fail over a calendar preference. */
  timezone: timezoneNameSchema.optional(),
})
export type ClaimRequest = z.infer<typeof claimRequestSchema>

// One timezone for the whole installation, so the Digest's calendar groups
// agree across the User's devices.
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

// In minutes. A Subscription is always exactly one preset; there is no
// free-form schedule to tune or to get wrong.
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

/** Exact Feed endpoint submitted by the User; discovery is deliberately absent. */
export const createSubscriptionRequestSchema = z.object({
  url: z.string().min(1).max(2_048),
})
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>

// Shared because both sides say the number: the server owns the ceiling, the
// client tells the User the number they just exceeded.
export const MAX_FEED_SIZE_MIB = 20

/** The largest OPML upload one import accepts, in UTF-16 code units. */
export const MAX_OPML_LENGTH = 1_048_576

export const importOpmlRequestSchema = z.object({
  opml: z.string().min(1).max(MAX_OPML_LENGTH),
})
export type ImportOpmlRequest = z.infer<typeof importOpmlRequestSchema>

// Recording is local, so the report speaks only of Subscriptions; whether
// each listed Feed answers is Feed Availability's story.
export const opmlImportReportSchema = z.object({
  added: z.number().int().nonnegative(),
  alreadySubscribed: z.number().int().nonnegative(),
  /** Outline URLs that could not become Subscriptions, verbatim from the file. */
  unusable: z.array(z.string()),
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

/** Consecutive failures before Feed Availability is surfaced to the User. */
export const FEED_UNAVAILABLE_AFTER_FAILURES = 3

// Deliberately coarse: enough to tell failures apart, never enough to carry
// a URL, a header, or response content.
export const feedAvailabilityCategorySchema = z.enum([
  'unreachable',
  'timeout',
  'too_large',
  'unsupported_content',
  'http_error',
  'invalid_feed',
])
export type FeedAvailabilityCategory = z.infer<typeof feedAvailabilityCategorySchema>

// `unchecked`: no retrieval has succeeded yet. `unavailable` begins at
// `FEED_UNAVAILABLE_AFTER_FAILURES` in a row; a Feed that simply publishes
// nothing stays `available`.
export const feedAvailabilitySchema = z.object({
  state: z.enum(['unchecked', 'available', 'unavailable']),
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

// The Subscription comes back unchecked: its first retrieval is scheduler
// work (ADR 0007), so the response cannot speak of items or reachability.
export const createSubscriptionResponseSchema = z.object({
  subscription: subscriptionSummarySchema,
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

export const CADENCE_GRID_WEEKS = 26

/** Days are in the installation timezone. */
export const cadenceObservationSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
})
export type CadenceObservation = z.infer<typeof cadenceObservationSchema>

// `date` is the installation-timezone day the cadence grid jumps to;
// `displayDate` is the same day in the meta row's format.
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

// `cadence` runs oldest to newest from the grid window's first day through
// today, so a fixed dataset always draws the same grid.
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
  /** Same-origin proxy path for the item's image; never a publisher URL. */
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
  /**
   * A page may end mid-day; the next page repeats that day's `date` and the
   * client merges the group.
   */
  groups: z.array(digestGroupSchema),
  /** Opaque cursor; null at the very end. */
  nextCursor: z.string().nullable(),
})
export type Digest = z.infer<typeof digestSchema>

// Carries its Feed attribution so a save outlives the Digest and, later, the
// Subscription itself.
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
  /** Newest first, in the Digest's own chronology. */
  items: z.array(libraryItemSchema),
  /** Opaque cursor; null at the very end. */
  nextCursor: z.string().nullable(),
})
export type Library = z.infer<typeof librarySchema>

// A resource bound, not a UX limit; typing never nears it.
export const MAX_SEARCH_QUERY_LENGTH = 256

export const searchQuerySchema = z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH)

// Deliberately no rank or score; matches sit in Digest chronology.
export const searchResultSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  displayDate: z.string(),
  saved: z.boolean(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResultsSchema = z.object({
  results: z.array(searchResultSchema),
})
export type SearchResults = z.infer<typeof searchResultsSchema>

/** How long a browser may keep a successful Reader extraction, privately. */
export const READER_CACHE_SECONDS = 86_400

/** How long a browser may keep a successfully proxied image, privately. */
export const IMAGE_CACHE_SECONDS = 7 * 86_400

// Extraction rewrites every Reader image reference to this same-origin route;
// the client renders no image from anywhere else, which keeps the CSP's
// `img-src` free of publisher origins.
export const READER_IMAGE_PATH = '/api/reader/image'

/** The Feed Item that follows in Digest order, so reading never dead-ends. */
export const readerNextSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedTitle: z.string(),
  displayTime: z.string(),
})
export type ReaderNext = z.infer<typeof readerNextSchema>

// Kept apart from the extracted article, which the browser may cache for a
// day: membership and what comes next must be the server's current answer.
export const readerItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  displayDate: z.string(),
  summary: z.string().nullable(),
  saved: z.boolean(),
  nextInDigest: readerNextSchema.nullable(),
})
export type ReaderItem = z.infer<typeof readerItemSchema>

// Markdown from the server's allowlist, never stored — losing it costs one
// re-extraction, never the Feed Item.
export const readerArticleSchema = z.object({
  feedItemId: z.number().int().positive(),
  markdown: z.string(),
  readingTimeMinutes: z.number().int().positive(),
})
export type ReaderArticle = z.infer<typeof readerArticleSchema>

// Both mutations answer with this, so a repeated save or an unsave of the
// already-unsaved describes the same state instead of an error.
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
