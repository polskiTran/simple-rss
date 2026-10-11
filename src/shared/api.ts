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

/** The job a Reader deadline answer was still waiting on when it was sent. */
const readerDeadlineStageSchema = z.enum(['publisher', 'parsing'])
export type ReaderDeadlineStage = z.infer<typeof readerDeadlineStageSchema>

/**
 * Every `error.code` the API answers with. The server cannot emit a code that
 * is not listed here, and the client can match on nothing else.
 */
export const apiErrorCodeSchema = z.enum([
  // Anywhere under /api
  'not_found',
  'internal_error',
  'unavailable',
  'unauthenticated',
  'forbidden_origin',
  'invalid_request',
  'invalid_cursor',
  // Authentication and installation preferences
  'already_claimed',
  'setup_unavailable',
  'invalid_credentials',
  'too_many_attempts',
  'unknown_timezone',
  // Subscriptions and Feed retrieval
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
  // Reader View over the Original webpage
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
  // Image proxy
  'image_unavailable',
  'image_busy',
  'image_rate_limited',
])
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Carried only by `article_deadline_exceeded`. */
    stage: readerDeadlineStageSchema.optional(),
  }),
})
/** The body of every API refusal. */
export type ApiErrorBody = z.infer<typeof apiErrorSchema>

export const MIN_PASSWORD_LENGTH = 12

/** Argon2id hashes bytes, so the password bound that matters is in UTF-8 bytes. */
export const MAX_PASSWORD_BYTES = 1024
const MAX_PASSWORD_LENGTH = 512

const utf8 = new TextEncoder()

/** Whether a password is short enough, in UTF-8 bytes, to hash. */
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

/** A password being chosen: held to the length rule. */
export const newPasswordSchema = passwordSchema(MIN_PASSWORD_LENGTH)

/** A password being presented: any non-empty one is checked against the verifier. */
const presentedPasswordSchema = passwordSchema(1)

export const authStatusSchema = z.object({
  /** Whether a User has claimed this installation. */
  claimed: z.boolean(),
  /** Whether the caller presented a live Session. */
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

/** A Feed or Feed Item identifier as it arrives in a path or query string. */
export const idParameterSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger)

/** Matches the bound the feeds table enforces on reported titles. */
export const MAX_FEED_TITLE_LENGTH = 512

/** One bound for both descriptions — the Feed Description and the Custom Description share the rule. */
export const MAX_FEED_DESCRIPTION_LENGTH = 1024

/** Replaces both overrides at once; null clears one so the reported value stands. */
export const updateFeedDetailsRequestSchema = z.object({
  customTitle: z.string().trim().min(1).max(MAX_FEED_TITLE_LENGTH).nullable(),
  customDescription: z.string().trim().min(1).max(MAX_FEED_DESCRIPTION_LENGTH).nullable(),
})
export type UpdateFeedDetailsRequest = z.infer<typeof updateFeedDetailsRequestSchema>

export const feedDetailsUpdateSchema = z.object({
  /** Effective: the Custom Title when set, else the reported title. */
  title: z.string(),
  customTitle: z.string().nullable(),
  /** Effective: the Custom Description when set, else the Feed Description. */
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
  /** Outline URLs that could not become Subscriptions, verbatim from the file. */
  unusable: z.array(z.string()),
})
export type OpmlImportReport = z.infer<typeof opmlImportReportSchema>

const feedSummarySchema = z.object({
  feedId: z.number().int().positive(),
  /** Effective: the Custom Title when set, else the reported title. */
  title: z.string(),
  /** Effective: the Custom Description when set, else the Feed Description; null when neither exists. */
  description: z.string().nullable(),
  /** Host of the home page when the Feed declares one, else host of the Feed URL. */
  domain: z.string(),
  /** The publisher's site, for linking the domain. Null until a retrieval finds one. */
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

// `unchecked`: no retrieval has succeeded yet. `unavailable` begins at
// `FEED_UNAVAILABLE_AFTER_FAILURES` in a row; a Feed that simply publishes
// nothing stays `available`. `lastSuccessDate` is the installation-timezone
// day the Feed last answered, for the client to name.
const feedAvailabilitySchema = z.object({
  state: z.enum(['unchecked', 'available', 'unavailable']),
  lastCheckedAt: z.string().nullable(),
  lastSuccessDate: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  category: feedAvailabilityCategorySchema.nullable(),
})
export type FeedAvailability = z.infer<typeof feedAvailabilitySchema>

export const CADENCE_STRIP_DAYS = 30

/** Daily item counts, oldest to newest, in the installation timezone. */
const cadenceStripSchema = z.array(z.number().int().nonnegative()).length(CADENCE_STRIP_DAYS)

const subscriptionSummarySchema = feedSummarySchema.extend({
  readingSource: readingSourceSchema,
  /** When this Subscription began; a revived one starts again. */
  subscribedAt: z.string(),
  cadence: cadenceStripSchema,
  availability: feedAvailabilitySchema,
})
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>

/** The address the Add feed dialog previews: a Feed, or a web page declaring some. */
export const feedPreviewRequestSchema = createSubscriptionRequestSchema
export type FeedPreviewRequest = z.infer<typeof feedPreviewRequestSchema>

export const FEED_PREVIEW_ITEMS = 5

/**
 * A Feed as one retrieval found it, before anything is recorded. `feedUrl` is
 * the address to subscribe with; `cadence` is drawn from the Feed Window alone,
 * and `lastItemAt` and `items` follow the Digest's chronology, newest first.
 */
const feedPreviewSchema = feedSummarySchema.pick({ title: true, domain: true, homePageUrl: true }).extend({
  feedUrl: z.string(),
  cadence: cadenceStripSchema,
  lastItemAt: z.string().nullable(),
  items: z.array(z.object({ title: z.string(), publishedAt: z.string().nullable() })).max(FEED_PREVIEW_ITEMS),
  /** Whether the address is already one of a subscribed Feed's own. */
  subscribed: z.boolean(),
})
export type FeedPreview = z.infer<typeof feedPreviewSchema>

/**
 * The address answered with a Feed, or with a web page and the Declared Feeds
 * that answered, in page order; a page declaring none answers an empty list.
 */
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

/** Days are in the installation timezone. */
const cadenceObservationSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
})
export type CadenceObservation = z.infer<typeof cadenceObservationSchema>

// `date` is the installation-timezone day the item is grouped under and the
// cadence grid jumps to; `displayTime` is its time on that day.
const feedItemRowSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  link: z.string().nullable(),
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  date: z.string(),
  displayTime: z.string(),
  saved: z.boolean(),
})
export type FeedItemRow = z.infer<typeof feedItemRowSchema>

// `cadence` runs oldest to newest from the grid window's first day through
// today, so a fixed dataset always draws the same grid.
export const feedDetailSchema = feedSummarySchema.extend({
  /** What the Feed document says, kept underneath any Custom Title. */
  reportedTitle: z.string(),
  customTitle: z.string().nullable(),
  /** The Feed Description as reported, kept underneath any Custom Description. */
  reportedDescription: z.string().nullable(),
  customDescription: z.string().nullable(),
  availability: feedAvailabilitySchema,
  schedule: pollingScheduleSchema,
  readingSource: readingSourceSchema,
  /** The installation-timezone day this Subscription began. */
  subscribedDate: z.string(),
  cadence: z.array(cadenceObservationSchema),
  items: z.array(feedItemRowSchema),
})
export type FeedDetail = z.infer<typeof feedDetailSchema>

const digestItemSchema = z.object({
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

/**
 * A Feed publishing on a group's day after a quiet spell of at least
 * `QUIET_SPELL_DAYS`: how many days since its previous item, and its Cadence
 * over the 30 days ending that day.
 */
const digestReturnSchema = z.object({
  feedId: z.number().int().positive(),
  quietDays: z.number().int().positive(),
  cadence: cadenceStripSchema,
})
export type DigestReturn = z.infer<typeof digestReturnSchema>

export const QUIET_SPELL_DAYS = 7

/** One whole installation-timezone day of the Digest, newest item first; the client names the day. */
const digestGroupSchema = z.object({
  date: z.string(),
  items: z.array(digestItemSchema),
  returns: z.array(digestReturnSchema),
})
export type DigestGroup = z.infer<typeof digestGroupSchema>

export const digestSchema = z.object({
  /** The installation-timezone day. */
  today: z.string(),
  /** Whole days, newest first: a page never ends mid-day. */
  groups: z.array(digestGroupSchema),
  /** The day the next page starts `from`; null at the very end. */
  nextFrom: z.string().nullable(),
})
export type Digest = z.infer<typeof digestSchema>

/** An installation-timezone calendar day, `2026-09-01`, that exists. */
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(time) && new Date(time).toISOString().startsWith(value)
  })

/**
 * Where the Digest starts: `from` a day — that day and every one before it —
 * rather than today. `digestParamsOf` and `digestRequestSchema` are the two
 * directions of one encoding.
 */
export interface DigestStart {
  readonly from?: string | undefined
}

export function digestParamsOf({ from }: DigestStart): URLSearchParams {
  return new URLSearchParams(from ? { from } : {})
}

export const digestRequestSchema = z.object({
  from: dateKeySchema.optional(),
}) satisfies z.ZodType<DigestStart>

/**
 * The Digest's own cadence: every day of the grid window, with `today` ending
 * it, and how many Subscriptions feed it — none means the Digest has yet to begin.
 */
export const digestCalendarSchema = z.object({
  today: z.string(),
  days: z.array(cadenceObservationSchema),
  subscriptions: z.number().int().nonnegative(),
})
export type DigestCalendar = z.infer<typeof digestCalendarSchema>

const libraryItemSchema = z.object({
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
  /** The installation-timezone day it was saved. */
  savedDate: z.string(),
})
export type LibraryItem = z.infer<typeof libraryItemSchema>

const LIBRARY_ORDERS = ['newest', 'oldest'] as const
export type LibraryOrder = (typeof LIBRARY_ORDERS)[number]

/** `?order=oldest` turns the Library around; absent is newest save first. */
export const libraryRequestSchema = z.object({
  order: z.enum(LIBRARY_ORDERS).default('newest'),
})

export const librarySchema = z.object({
  /** The installation-timezone day, so saves read as today or yesterday. */
  today: z.string(),
  /** Every save, not just this page's. */
  total: z.number().int().nonnegative(),
  /** By saved time, in the requested order. */
  items: z.array(libraryItemSchema),
  /** Opaque cursor; null at the very end. */
  nextCursor: z.string().nullable(),
})
export type Library = z.infer<typeof librarySchema>

export const USER_EXPORT_FORMAT = 'simple-rss-export'

/** Version 4 adds the per-Subscription Reading Source. */
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

/** `subscription` is null for a Feed kept only because Library saves still attribute to it. */
const userExportFeedSchema = z.object({
  enteredUrl: z.string(),
  resolvedUrl: z.string(),
  /** The reported title and Feed Description; the User's overrides live on `subscription`. */
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

/**
 * The Search Scope: the part of the reading a search answers from, taken from
 * the screen the line was invoked on. An opened Feed answers its own Feed
 * Items, the Library its saved ones, and the Feeds screen only its
 * Subscriptions. The Digest, the Reader and settings search everywhere.
 */
export type SearchScope =
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'subscriptions' }
  | { readonly kind: 'feed'; readonly feedId: number }

/**
 * How a search ranks what it found: best match (ADR 0009) or newest first.
 * Either way it answers at most fifty — the newest fifty matches, not the best
 * fifty re-sorted.
 */
const SEARCH_SORTS = ['best', 'newest'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

/**
 * How a search travels, in the client address and the API request alike: `q`
 * for the words, then at most one scope parameter beside it — `feed=<id>` or
 * `in=saved|subscriptions` — and `sort=newest` when not ranked by best match.
 * Everywhere needs no scope. `searchParamsOf` and `searchRequestSchema` are the
 * two directions of one encoding.
 */
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
  /** The installation-timezone day it is listed under, and its time on that day. */
  date: z.string(),
  displayTime: z.string(),
  saved: z.boolean(),
  // Plain-text fragment of the summary around the match; null when only the
  // title or Feed title matched — both already visible in the item shape.
  snippet: z.string().nullable(),
})
export type SearchResult = z.infer<typeof searchResultSchema>

// A current Subscription the query matched by effective title or domain —
// never the Feed Description.
const searchSubscriptionMatchSchema = feedSummarySchema
  .pick({ feedId: true, title: true, domain: true, homePageUrl: true })
  .extend({ cadence: cadenceStripSchema })
export type SearchSubscriptionMatch = z.infer<typeof searchSubscriptionMatchSchema>

const searchItemsSchema = z.array(searchResultSchema)
const searchJumpToSchema = z.array(searchSubscriptionMatchSchema)

/**
 * The answer carries only what its scope can hold: the jump-to group
 * everywhere and on the Feeds screen, ranked Feed Items everywhere else, and
 * the effective title of the Feed a Feed-scoped search answered from, so the
 * surface can name it. Every answer carries the installation-timezone `today`
 * its items' days are named against.
 */
export const searchResultsSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('everywhere'),
    today: z.string(),
    subscriptions: searchJumpToSchema,
    results: searchItemsSchema,
  }),
  z.object({ scope: z.literal('saved'), today: z.string(), results: searchItemsSchema }),
  z.object({ scope: z.literal('subscriptions'), today: z.string(), subscriptions: searchJumpToSchema }),
  z.object({
    scope: z.literal('feed'),
    today: z.string(),
    feed: z.object({ title: z.string() }),
    results: searchItemsSchema,
  }),
])
export type SearchResults = z.infer<typeof searchResultsSchema>

export const READER_CACHE_SECONDS = 86_400

export const IMAGE_CACHE_SECONDS = 7 * 86_400

export const READER_IMAGE_PATH = '/api/reader/image'

/** The Feed Item that follows in Digest order, so reading never dead-ends. */
const readerNextSchema = z.object({
  feedItemId: z.number().int().positive(),
  title: z.string(),
  feedTitle: z.string(),
  displayTime: z.string(),
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
  publishedAt: z.string().nullable(),
  firstSeenAt: z.string(),
  /** The installation-timezone day it is listed under, and that timezone's today. */
  date: z.string(),
  today: z.string(),
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
