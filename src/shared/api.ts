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

export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(time) && new Date(time).toISOString().startsWith(value)
  })
  .brand<'DateKey'>()
export type DateKey = z.infer<typeof dateKeySchema>

export function utcDayKey(instant: number): DateKey {
  // SAFETY: the first ten characters of an ISO instant are the calendar day it falls on in UTC.
  return new Date(instant).toISOString().slice(0, 10) as DateKey
}

const readerDeadlineStageSchema = z.enum(['publisher', 'parsing'])
export type ReaderDeadlineStage = z.infer<typeof readerDeadlineStageSchema>

export const apiErrorCodeSchema = z.enum([
  'not_found',
  'internal_error',
  'unavailable',
  'unauthenticated',
  'forbidden_origin',
  'invalid_request',
  'invalid_cursor',
  'already_claimed',
  'setup_unavailable',
  'invalid_credentials',
  'too_many_attempts',
  'unknown_timezone',
  'invalid_feed_url',
  'duplicate_subscription',
  'refresh_rate_limited',
  'unsupported_feed',
  'malformed_feed',
  'feed_unreachable',
  'feed_too_large',
  'feed_timeout',
  'feed_body_timeout',
  'malformed_opml',
  'unsupported_opml',
  'too_many_feeds',
  'no_original_link',
  'article_unreadable',
  'article_deadline_exceeded',
  'reader_retry_rate_limited',
  'article_link_unsafe',
  'unsupported_article',
  'article_unreachable',
  'article_too_large',
  'article_timeout',
  'article_body_timeout',
  'image_unavailable',
  'image_busy',
  'image_rate_limited',
])
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

const stagedErrorCodeSchema = z.literal('article_deadline_exceeded')

const unstagedErrorCodeSchema = apiErrorCodeSchema.exclude([stagedErrorCodeSchema.value])
export type UnstagedErrorCode = z.infer<typeof unstagedErrorCodeSchema>

export const apiErrorSchema = z.object({
  error: z.discriminatedUnion('code', [
    z.object({ code: stagedErrorCodeSchema, message: z.string(), stage: readerDeadlineStageSchema }).strict(),
    z.object({ code: unstagedErrorCodeSchema, message: z.string() }).strict(),
  ]),
})
export type ApiErrorBody = z.infer<typeof apiErrorSchema>
export type ApiFailure = ApiErrorBody['error']

export const MIN_PASSWORD_LENGTH = 12

export const MIN_SETUP_SECRET_LENGTH = 16

export const MAX_PASSWORD_BYTES = 1024
const MAX_PASSWORD_LENGTH = 512

const utf8 = new TextEncoder()

export function fitsPasswordBytes(password: string): boolean {
  return utf8.encode(password).length <= MAX_PASSWORD_BYTES
}

function passwordSchema(minLength: number) {
  return z
    .string()
    .min(minLength)
    .max(MAX_PASSWORD_LENGTH)
    .refine(fitsPasswordBytes, { message: `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes` })
}

export const newPasswordSchema = passwordSchema(MIN_PASSWORD_LENGTH)

const presentedPasswordSchema = passwordSchema(1)

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

export const READING_SOURCES = ['original-webpage', 'feed-content'] as const
export type ReadingSource = (typeof READING_SOURCES)[number]

const readingSourceSchema = z.enum(READING_SOURCES)

export const DEFAULT_READING_SOURCE: ReadingSource = 'original-webpage'

export const readingSourcePreferenceSchema = z.object({
  readingSource: readingSourceSchema,
})
export type ReadingSourcePreference = z.infer<typeof readingSourcePreferenceSchema>

export const pollingScheduleSchema = z.object({
  pollingIntervalMinutes: pollingIntervalMinutesSchema,
  nextPollAt: z.string(),
})
export type PollingSchedule = z.infer<typeof pollingScheduleSchema>

export const idParameterSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger)

export const MAX_FEED_TITLE_LENGTH = 512

export const MAX_FEED_DESCRIPTION_LENGTH = 1024

export const updateFeedDetailsRequestSchema = z.object({
  customTitle: z.string().trim().min(1).max(MAX_FEED_TITLE_LENGTH).nullable(),
  customDescription: z.string().trim().min(1).max(MAX_FEED_DESCRIPTION_LENGTH).nullable(),
})
export type UpdateFeedDetailsRequest = z.infer<typeof updateFeedDetailsRequestSchema>

export const feedDetailsUpdateSchema = z.object({
  title: z.string(),
  customTitle: z.string().nullable(),
  description: z.string().nullable(),
  customDescription: z.string().nullable(),
})
export type FeedDetailsUpdate = z.infer<typeof feedDetailsUpdateSchema>

export const createSubscriptionRequestSchema = z.object({
  url: z.string().min(1).max(2_048),
})
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>

export const MAX_FEED_SIZE_MIB = 20

const MAX_OPML_UTF16_UNITS = 1_048_576

export const importOpmlRequestSchema = z.object({
  opml: z.string().min(1).max(MAX_OPML_UTF16_UNITS),
})
export type ImportOpmlRequest = z.infer<typeof importOpmlRequestSchema>

export const opmlImportReportSchema = z.object({
  added: z.number().int().nonnegative(),
  alreadySubscribed: z.number().int().nonnegative(),
  unusable: z.array(z.string()),
})
export type OpmlImportReport = z.infer<typeof opmlImportReportSchema>

const feedSummarySchema = z.object({
  feedId: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  domain: z.string(),
  homePageUrl: z.string().nullable(),
  enteredUrl: z.string(),
  resolvedUrl: z.string(),
})

export const FEED_UNAVAILABLE_AFTER_FAILURES = 3

export const FEED_AVAILABILITY_CATEGORIES = [
  'unreachable',
  'timeout',
  'too_large',
  'unsupported_content',
  'http_error',
  'invalid_feed',
] as const
export type FeedAvailabilityCategory = (typeof FEED_AVAILABILITY_CATEGORIES)[number]

const feedAvailabilityCategorySchema = z.enum(FEED_AVAILABILITY_CATEGORIES)

const failureRunSchema = z.number().int().nonnegative()
const feedAvailabilitySchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('unchecked'),
    lastCheckedAt: z.string().nullable(),
    lastSuccessDate: z.null(),
    consecutiveFailures: failureRunSchema,
    category: feedAvailabilityCategorySchema.nullable(),
  }),
  z.object({
    state: z.literal('available'),
    lastCheckedAt: z.string(),
    lastSuccessDate: dateKeySchema,
    consecutiveFailures: failureRunSchema,
    category: feedAvailabilityCategorySchema.nullable(),
  }),
  z.object({
    state: z.literal('unavailable'),
    lastCheckedAt: z.string(),
    lastSuccessDate: dateKeySchema.nullable(),
    consecutiveFailures: failureRunSchema.min(FEED_UNAVAILABLE_AFTER_FAILURES),
    category: feedAvailabilityCategorySchema,
  }),
])
export type FeedAvailability = z.infer<typeof feedAvailabilitySchema>

export const CADENCE_STRIP_DAYS = 30

const cadenceStripSchema = z.array(z.number().int().nonnegative()).length(CADENCE_STRIP_DAYS)

const subscriptionSummarySchema = feedSummarySchema.extend({
  readingSource: readingSourceSchema,
  subscribedAt: z.string(),
  cadence: cadenceStripSchema,
  availability: feedAvailabilitySchema,
})
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>

export const feedPreviewRequestSchema = createSubscriptionRequestSchema
export type FeedPreviewRequest = z.infer<typeof feedPreviewRequestSchema>

export const FEED_PREVIEW_ITEMS = 5

const feedPreviewSchema = feedSummarySchema.pick({ title: true, domain: true, homePageUrl: true }).extend({
  feedUrl: z.string(),
  cadence: cadenceStripSchema,
  today: dateKeySchema,
  lastItemDate: dateKeySchema.nullable(),
  items: z.array(z.object({ title: z.string(), date: dateKeySchema })).max(FEED_PREVIEW_ITEMS),
  subscribed: z.boolean(),
})
export type FeedPreview = z.infer<typeof feedPreviewSchema>

export const feedPreviewResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('feed'), feed: feedPreviewSchema }),
  z.object({ kind: z.literal('page'), host: z.string(), feeds: z.array(feedPreviewSchema) }),
])
export type FeedPreviewResponse = z.infer<typeof feedPreviewResponseSchema>

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

const cadenceObservationSchema = z.object({
  date: dateKeySchema,
  count: z.number().int().nonnegative(),
})
export type CadenceObservation = z.infer<typeof cadenceObservationSchema>

const feedItemRowSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  date: dateKeySchema,
  displayTime: z.string().nullable(),
  saved: z.boolean(),
})
export type FeedItemRow = z.infer<typeof feedItemRowSchema>

export const feedDetailSchema = feedSummarySchema.extend({
  reportedTitle: z.string(),
  customTitle: z.string().nullable(),
  reportedDescription: z.string().nullable(),
  customDescription: z.string().nullable(),
  availability: feedAvailabilitySchema,
  schedule: pollingScheduleSchema,
  readingSource: readingSourceSchema,
  subscribedDate: dateKeySchema,
  cadence: z.array(cadenceObservationSchema),
})
export type FeedDetail = z.infer<typeof feedDetailSchema>

export const feedItemsSchema = z.object({
  items: z.array(feedItemRowSchema),
  nextFrom: dateKeySchema.nullable(),
})
export type FeedItems = z.infer<typeof feedItemsSchema>

const digestItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  displayTime: z.string().nullable(),
  imageUrl: z.string().nullable(),
  summary: z.string().nullable(),
  firstSeenAt: z.string(),
  saved: z.boolean(),
})
export type DigestItem = z.infer<typeof digestItemSchema>

const digestReturnSchema = z.object({
  feedId: z.number().int().positive(),
  quietDays: z.number().int().positive(),
})
export type DigestReturn = z.infer<typeof digestReturnSchema>

export const QUIET_SPELL_DAYS = 7

const digestGroupSchema = z.object({
  date: dateKeySchema,
  items: z.array(digestItemSchema),
  returns: z.array(digestReturnSchema),
})
export type DigestGroup = z.infer<typeof digestGroupSchema>

export const digestSchema = z.object({
  today: dateKeySchema,
  groups: z.array(digestGroupSchema),
  nextFrom: dateKeySchema.nullable(),
})
export type Digest = z.infer<typeof digestSchema>

export interface DigestStart {
  readonly from?: DateKey | undefined
  readonly through?: DateKey | undefined
}

export function digestParamsOf({ from, through }: DigestStart): URLSearchParams {
  return new URLSearchParams({ ...(from ? { from } : {}), ...(through ? { through } : {}) })
}

export const digestRequestSchema = z.object({
  from: dateKeySchema.optional(),
  through: dateKeySchema.optional(),
}) satisfies z.ZodType<DigestStart, z.ZodTypeDef, unknown>

export const digestCalendarSchema = z.object({
  today: dateKeySchema,
  days: z.array(cadenceObservationSchema),
  subscriptions: z.number().int().nonnegative(),
})
export type DigestCalendar = z.infer<typeof digestCalendarSchema>

const libraryItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  subscribed: z.boolean(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  savedAt: z.string(),
  savedDate: dateKeySchema,
})
export type LibraryItem = z.infer<typeof libraryItemSchema>

const LIBRARY_ORDERS = ['newest', 'oldest'] as const
export type LibraryOrder = (typeof LIBRARY_ORDERS)[number]

export const libraryRequestSchema = z.object({
  order: z.enum(LIBRARY_ORDERS).default('newest'),
})

export const librarySchema = z.object({
  today: dateKeySchema,
  total: z.number().int().nonnegative(),
  items: z.array(libraryItemSchema),
  nextCursor: z.string().nullable(),
})
export type Library = z.infer<typeof librarySchema>

export const USER_EXPORT_FORMAT = 'simple-rss-export'

export const USER_EXPORT_VERSION = 4

const userExportItemSchema = z.object({
  dedupeKey: z.string(),
  identityKind: z.enum(['guid', 'link', 'content']),
  title: z.string().nullable(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  imageUrl: z.string().nullable(),
  summary: z.string().nullable(),
  firstSeenAt: z.string(),
  lastObservedAt: z.string(),
  savedAt: z.string().nullable(),
})
export type UserExportItem = z.infer<typeof userExportItemSchema>

const userExportFeedSchema = z.object({
  enteredUrl: z.string(),
  resolvedUrl: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  domain: z.string(),
  homePageUrl: z.string().nullable(),
  createdAt: z.string(),
  subscription: z
    .object({
      pollingIntervalMinutes: pollingIntervalMinutesSchema,
      readingSource: readingSourceSchema,
      customTitle: z.string().nullable(),
      customDescription: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  items: z.array(userExportItemSchema),
})
export type UserExportFeed = z.infer<typeof userExportFeedSchema>

export const userExportSchema = z.object({
  format: z.literal(USER_EXPORT_FORMAT),
  exportVersion: z.literal(USER_EXPORT_VERSION),
  applicationVersion: z.string(),
  exportedAt: z.string(),
  installation: installationPreferencesSchema,
  feeds: z.array(userExportFeedSchema),
})
export type UserExport = z.infer<typeof userExportSchema>

export const MAX_SEARCH_QUERY_LENGTH = 256

const searchQuerySchema = z.string().min(1).max(MAX_SEARCH_QUERY_LENGTH)

export type SearchScope =
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'subscriptions' }
  | { readonly kind: 'feed'; readonly feedId: number }

const SEARCH_SORTS = ['best', 'newest'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export function searchParamsOf(query: string, scope: SearchScope, sort: SearchSort = 'best'): URLSearchParams {
  const params = new URLSearchParams({ q: query })
  if (scope.kind === 'feed') params.set('feed', String(scope.feedId))
  else if (scope.kind !== 'everywhere') params.set('in', scope.kind)
  if (sort !== 'best') params.set('sort', sort)
  return params
}

export const searchRequestSchema = z
  .object({
    q: searchQuerySchema,
    feed: idParameterSchema.optional(),
    in: z.enum(['saved', 'subscriptions']).optional(),
    sort: z.enum(SEARCH_SORTS).default('best'),
  })
  .refine((request) => request.feed === undefined || request.in === undefined, 'A search takes one scope at most')
  .transform(({ q, feed, in: within, sort }) => ({
    query: q,
    scope: (feed !== undefined
      ? { kind: 'feed', feedId: feed }
      : within !== undefined
        ? { kind: within }
        : { kind: 'everywhere' }) satisfies SearchScope,
    sort,
  }))

const searchResultSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  date: dateKeySchema,
  displayTime: z.string().nullable(),
  saved: z.boolean(),
  snippet: z.string().nullable(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

const searchSubscriptionMatchSchema = feedSummarySchema
  .pick({ feedId: true, title: true, domain: true, homePageUrl: true })
  .extend({ cadence: cadenceStripSchema })
export type SearchSubscriptionMatch = z.infer<typeof searchSubscriptionMatchSchema>

const searchItemsSchema = z.array(searchResultSchema)
const searchJumpToSchema = z.array(searchSubscriptionMatchSchema)

export const searchResultsSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('everywhere'),
    today: dateKeySchema,
    subscriptions: searchJumpToSchema,
    results: searchItemsSchema,
  }),
  z.object({ scope: z.literal('saved'), today: dateKeySchema, results: searchItemsSchema }),
  z.object({ scope: z.literal('subscriptions'), today: dateKeySchema, subscriptions: searchJumpToSchema }),
  z.object({
    scope: z.literal('feed'),
    today: dateKeySchema,
    feed: z.object({ title: z.string() }),
    results: searchItemsSchema,
  }),
])
export type SearchResults = z.infer<typeof searchResultsSchema>

export const READER_CACHE_SECONDS = 86_400

export const IMAGE_CACHE_SECONDS = 7 * 86_400

export const READER_IMAGE_PATH = '/api/reader/image'

const readerNextSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedTitle: z.string(),
  displayTime: z.string().nullable(),
})

const feedContentSchema = z.object({
  markdown: z.string().min(1),
  truncated: z.boolean(),
  readingTimeMinutes: z.number().int().positive(),
})
export type FeedContent = z.infer<typeof feedContentSchema>

export const readerItemSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedId: z.number().int().positive(),
  feedTitle: z.string(),
  link: z.string().nullable(),
  discussionUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  date: dateKeySchema,
  today: dateKeySchema,
  summary: z.string().nullable(),
  saved: z.boolean(),
  readingSource: readingSourceSchema,
  nextInDigest: readerNextSchema.nullable(),
  feedContent: feedContentSchema.nullable(),
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
