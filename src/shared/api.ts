import { z } from 'zod'

export const livenessSchema = z.object({
  status: z.literal('live'),
})
export type Liveness = z.infer<typeof livenessSchema>

export const readinessSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }),
  z.object({ status: z.literal('unready'), reason: z.string() }),
])
export type Readiness = z.infer<typeof readinessSchema>

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

export const MIN_PASSWORD_LENGTH = 12

export const MAX_PASSWORD_BYTES = 1024
export const MAX_PASSWORD_LENGTH = 512

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH)
  .refine((password) => utf8ByteLength(password) <= MAX_PASSWORD_BYTES, {
    message: `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes`,
  })

const presentedPasswordSchema = z
  .string()
  .min(1)
  .max(MAX_PASSWORD_LENGTH)
  .refine((password) => utf8ByteLength(password) <= MAX_PASSWORD_BYTES)

export const authStatusSchema = z.object({
  claimed: z.boolean(),
  authenticated: z.boolean(),
})
export type AuthStatus = z.infer<typeof authStatusSchema>

const timezoneNameSchema = z.string().min(1).max(100)

export const claimRequestSchema = z.object({
  setupSecret: z.string().min(1).max(1024),
  password: newPasswordSchema,
  timezone: timezoneNameSchema.optional(),
})
export type ClaimRequest = z.infer<typeof claimRequestSchema>

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

export const POLLING_INTERVAL_MINUTES = [30, 60, 120, 360, 720, 1440] as const
export type PollingIntervalMinutes = (typeof POLLING_INTERVAL_MINUTES)[number]

export const DEFAULT_POLLING_INTERVAL_MINUTES: PollingIntervalMinutes = 120

const offeredIntervals: ReadonlySet<number> = new Set(POLLING_INTERVAL_MINUTES)

export const pollingIntervalMinutesSchema = z
  .number()
  .refine((value): value is PollingIntervalMinutes => offeredIntervals.has(value))

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

/** Matches the bound the feeds table enforces on reported titles. */
export const MAX_FEED_TITLE_LENGTH = 512

export const updateFeedDetailsRequestSchema = z.object({
  /** The Custom Title; null clears the override so the reported title stands. */
  customTitle: z.string().trim().min(1).max(MAX_FEED_TITLE_LENGTH).nullable(),
})
export type UpdateFeedDetailsRequest = z.infer<typeof updateFeedDetailsRequestSchema>

export const feedDetailsUpdateSchema = z.object({
  /** Effective: the Custom Title when set, else the reported title. */
  title: z.string(),
  customTitle: z.string().nullable(),
})
export type FeedDetailsUpdate = z.infer<typeof feedDetailsUpdateSchema>

export const createSubscriptionRequestSchema = z.object({
  url: z.string().min(1).max(2_048),
})
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>

export const MAX_FEED_SIZE_MIB = 20

export const MAX_OPML_UTF16_UNITS = 1_048_576

export const importOpmlRequestSchema = z.object({
  opml: z.string().min(1).max(MAX_OPML_UTF16_UNITS),
})
export type ImportOpmlRequest = z.infer<typeof importOpmlRequestSchema>

export const opmlImportReportSchema = z.object({
  added: z.number().int().nonnegative(),
  alreadySubscribed: z.number().int().nonnegative(),
  /** Outline URLs that could not become Subscriptions, verbatim from the file. */
  unusable: z.array(z.string()),
})
export type OpmlImportReport = z.infer<typeof opmlImportReportSchema>

export const feedSummarySchema = z.object({
  feedId: z.number().int().positive(),
  /** Effective: the Custom Title when set, else the reported title. */
  title: z.string(),
  /** Host of the home page when the Feed declares one, else host of the Feed URL. */
  domain: z.string(),
  /** The publisher's site, for linking the domain. Null until a retrieval finds one. */
  homePageUrl: z.string().nullable(),
  enteredUrl: z.string(),
  resolvedUrl: z.string(),
})
export type FeedSummary = z.infer<typeof feedSummarySchema>

export const FEED_UNAVAILABLE_AFTER_FAILURES = 3

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
  /** What the Feed document says, kept underneath any Custom Title. */
  reportedTitle: z.string(),
  customTitle: z.string().nullable(),
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

export const MAX_SEARCH_QUERY_LENGTH = 256

export const searchQuerySchema = z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH)

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

export const READER_CACHE_SECONDS = 86_400

export const IMAGE_CACHE_SECONDS = 7 * 86_400

export const READER_IMAGE_PATH = '/api/reader/image'

/** The Feed Item that follows in Digest order, so reading never dead-ends. */
export const readerNextSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedTitle: z.string(),
  displayTime: z.string(),
})
export type ReaderNext = z.infer<typeof readerNextSchema>

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

export const readerArticleSchema = z.object({
  feedItemId: z.number().int().positive(),
  markdown: z.string(),
  readingTimeMinutes: z.number().int().positive(),
})
export type ReaderArticle = z.infer<typeof readerArticleSchema>

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
