import {
  apiErrorSchema,
  authStatusSchema,
  createSubscriptionResponseSchema,
  digestCalendarSchema,
  digestParamsOf,
  digestSchema,
  feedDetailSchema,
  feedDetailsUpdateSchema,
  feedPreviewResponseSchema,
  installationPreferencesSchema,
  libraryMembershipSchema,
  librarySchema,
  opmlImportReportSchema,
  pollingScheduleSchema,
  readingSourcePreferenceSchema,
  readerArticleSchema,
  readerItemSchema,
  refreshFeedResponseSchema,
  searchParamsOf,
  searchResultsSchema,
  subscriptionListSchema,
  serviceMetaSchema,
  type ApiErrorCode,
  type AuthStatus,
  type ClaimRequest,
  type CreateSubscriptionRequest,
  type CreateSubscriptionResponse,
  type Digest,
  type DigestCalendar,
  type DigestStart,
  type FeedDetail,
  type FeedDetailsUpdate,
  type FeedPreviewRequest,
  type FeedPreviewResponse,
  type ImportOpmlRequest,
  type InstallationPreferences,
  type Library,
  type LibraryOrder,
  type LibraryMembership,
  type OpmlImportReport,
  type PasswordChangeRequest,
  type PollingIntervalMinutes,
  type PollingSchedule,
  type ReadingSource,
  type ReadingSourcePreference,
  type ReaderArticle,
  type ReaderDeadlineStage,
  type ReaderItem,
  type RefreshFeedResponse,
  type SearchResults,
  type SearchScope,
  type SearchSort,
  type SignInRequest,
  type SubscriptionList,
  type ServiceMeta,
  type UpdateFeedDetailsRequest,
  type UpdatePollingIntervalRequest,
  type UpdateTimezoneRequest,
} from '../shared/api.js'
import type { z } from 'zod'
import type { JsonValue } from '../shared/json.js'

/** An API refusal's `error.code`, or `unknown` when the answer carried no error body the client could read. */
type FailureCode = ApiErrorCode | 'unknown'

export class ApiError extends Error {
  readonly status: number
  readonly code: FailureCode
  readonly retryAfterSeconds: number | undefined
  readonly stage: ReaderDeadlineStage | undefined

  constructor(status: number, code: FailureCode, retryAfterSeconds?: number, stage?: ReaderDeadlineStage) {
    super(`Request failed with ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.stage = stage
  }
}

type SessionEndedHandler = () => void

let sessionEnded: SessionEndedHandler | undefined

export function onSessionEnded(handler: SessionEndedHandler): () => void {
  sessionEnded = handler
  return () => {
    if (sessionEnded === handler) sessionEnded = undefined
  }
}

const STATUS_PATH = '/api/auth/status'

const REQUEST_TIMEOUT_MS = 30_000
const READER_REQUEST_TIMEOUT_MS = 60_000

interface ApiRequestOptions extends RequestInit {
  readonly timeoutMs?: number
}

/** What the client checks an answer against: any schema in `shared/api.ts`. */
type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>

async function request(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options
  const deadline = AbortSignal.timeout(timeoutMs)
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
    credentials: 'same-origin',
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  })

  if (response.ok) return response

  const failure = await failureOf(response)

  if (failure.code === 'unauthenticated' && path !== STATUS_PATH) sessionEnded?.()

  throw new ApiError(response.status, failure.code, retryAfterOf(response), failure.stage)
}

/** Reads `path` and checks the answer against `schema`. */
async function getJson<T>(
  path: string,
  schema: Schema<T>,
  options: { readonly signal?: AbortSignal | undefined; readonly timeoutMs?: number } = {},
): Promise<T> {
  const { signal, ...rest } = options
  const response = await request(path, signal ? { ...rest, signal } : rest)
  return schema.parse(await response.json())
}

/** Sends `body` as JSON — or nothing, when it is undefined — and checks the answer against `schema`; `signal` abandons it. */
async function sendJson<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: JsonValue | undefined,
  schema: Schema<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await request(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  })
  return schema.parse(await response.json())
}

/** `path`, with `?params` only when there are any. */
function withQuery(path: string, params: URLSearchParams): string {
  return params.size > 0 ? `${path}?${params}` : path
}

export function fetchAuthStatus(): Promise<AuthStatus> {
  return getJson(STATUS_PATH, authStatusSchema)
}

export function claimInstallation(setupSecret: string, password: string): Promise<AuthStatus> {
  const timezone = detectedTimezone()
  return sendJson(
    'POST',
    '/api/auth/setup',
    { setupSecret, password, ...(timezone === undefined ? {} : { timezone }) } satisfies ClaimRequest,
    authStatusSchema,
  )
}

function detectedTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export function signIn(password: string): Promise<AuthStatus> {
  return sendJson('POST', '/api/auth/session', { password } satisfies SignInRequest, authStatusSchema)
}

export async function signOut(): Promise<void> {
  await request('/api/auth/session', { method: 'DELETE' })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<AuthStatus> {
  return sendJson(
    'POST',
    '/api/auth/password',
    { currentPassword, newPassword } satisfies PasswordChangeRequest,
    authStatusSchema,
  )
}

/** What an address answers — a Feed, or a page and the Feeds it declares — with nothing recorded. */
export function previewFeed(url: string, signal: AbortSignal): Promise<FeedPreviewResponse> {
  return sendJson(
    'POST',
    '/api/subscriptions/preview',
    { url } satisfies FeedPreviewRequest,
    feedPreviewResponseSchema,
    signal,
  )
}

/** Retrieves the Feed again and records it only when it answers; a refusal carries the reason. */
export function subscribeToFeed(url: string): Promise<CreateSubscriptionResponse> {
  return sendJson(
    'POST',
    '/api/subscriptions',
    { url } satisfies CreateSubscriptionRequest,
    createSubscriptionResponseSchema,
  )
}

export function importOpml(opml: string): Promise<OpmlImportReport> {
  return sendJson('POST', '/api/subscriptions/import', { opml } satisfies ImportOpmlRequest, opmlImportReportSchema)
}

export function refreshFeed(feedId: number): Promise<RefreshFeedResponse> {
  return sendJson('POST', `/api/feeds/${feedId}/refresh`, undefined, refreshFeedResponseSchema)
}

export function fetchSubscriptions(signal?: AbortSignal): Promise<SubscriptionList> {
  return getJson('/api/feeds', subscriptionListSchema, { signal })
}

export function fetchFeedDetail(feedId: number, signal?: AbortSignal): Promise<FeedDetail> {
  return getJson(`/api/feeds/${feedId}`, feedDetailSchema, { signal })
}

export function updateFeedDetails(feedId: number, details: UpdateFeedDetailsRequest): Promise<FeedDetailsUpdate> {
  return sendJson('PUT', `/api/feeds/${feedId}/details`, details, feedDetailsUpdateSchema)
}

export function updatePollingInterval(
  feedId: number,
  pollingIntervalMinutes: PollingIntervalMinutes,
): Promise<PollingSchedule> {
  return sendJson(
    'PUT',
    `/api/feeds/${feedId}/interval`,
    { pollingIntervalMinutes } satisfies UpdatePollingIntervalRequest,
    pollingScheduleSchema,
  )
}

export function updateReadingSource(feedId: number, readingSource: ReadingSource): Promise<ReadingSourcePreference> {
  return sendJson(
    'PUT',
    `/api/feeds/${feedId}/reading-source`,
    { readingSource } satisfies ReadingSourcePreference,
    readingSourcePreferenceSchema,
  )
}

/** Polling stops and the Feed's items leave the Digest; saved items stay in the Library. */
export async function unsubscribeFromFeed(feedId: number): Promise<void> {
  await request(`/api/feeds/${feedId}`, { method: 'DELETE' })
}

export function fetchDigest(start: DigestStart, signal?: AbortSignal): Promise<Digest> {
  return getJson(withQuery('/api/digest', digestParamsOf(start)), digestSchema, { signal })
}

export function fetchDigestCalendar(signal?: AbortSignal): Promise<DigestCalendar> {
  return getJson('/api/digest/days', digestCalendarSchema, { signal })
}

/** Searches retained reading metadata only, within the scope; results ranked by match quality blended with recency. */
export function fetchSearchResults(
  query: string,
  scope: SearchScope,
  sort: SearchSort,
  signal?: AbortSignal,
): Promise<SearchResults> {
  return getJson(withQuery('/api/search', searchParamsOf(query, scope, sort)), searchResultsSchema, { signal })
}

/** Newest save first needs no parameter; a cursor continues the order it came from. */
export function fetchLibrary(order: LibraryOrder, cursor?: string, signal?: AbortSignal): Promise<Library> {
  const params = new URLSearchParams()
  if (order !== 'newest') params.set('order', order)
  if (cursor) params.set('cursor', cursor)
  return getJson(withQuery('/api/library', params), librarySchema, { signal })
}

export function saveToLibrary(feedItemId: number): Promise<LibraryMembership> {
  return sendJson('PUT', `/api/library/${feedItemId}`, undefined, libraryMembershipSchema)
}

export function unsaveFromLibrary(feedItemId: number): Promise<LibraryMembership> {
  return sendJson('DELETE', `/api/library/${feedItemId}`, undefined, libraryMembershipSchema)
}

export function fetchReaderItem(feedItemId: number, signal?: AbortSignal): Promise<ReaderItem> {
  return getJson(`/api/items/${feedItemId}`, readerItemSchema, { signal })
}

export function fetchReaderArticle(feedItemId: number, signal?: AbortSignal): Promise<ReaderArticle> {
  return getJson(`/api/items/${feedItemId}/reader`, readerArticleSchema, {
    signal,
    timeoutMs: READER_REQUEST_TIMEOUT_MS,
  })
}

export function fetchInstallationPreferences(signal?: AbortSignal): Promise<InstallationPreferences> {
  return getJson('/api/settings', installationPreferencesSchema, { signal })
}

export function updateInstallationTimezone(timezone: string): Promise<InstallationPreferences> {
  return sendJson(
    'PUT',
    '/api/settings/timezone',
    { timezone } satisfies UpdateTimezoneRequest,
    installationPreferencesSchema,
  )
}

export function fetchServiceMeta(signal?: AbortSignal): Promise<ServiceMeta> {
  return getJson('/api/meta', serviceMetaSchema, { signal })
}

async function failureOf(response: Response): Promise<{ code: FailureCode; stage?: ReaderDeadlineStage }> {
  try {
    const { error } = apiErrorSchema.parse(await response.json())
    return { code: error.code, ...(error.stage === undefined ? {} : { stage: error.stage }) }
  } catch {
    return { code: 'unknown' }
  }
}

function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}
