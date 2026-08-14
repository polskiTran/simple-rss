import {
  apiErrorSchema,
  authStatusSchema,
  createSubscriptionResponseSchema,
  digestSchema,
  feedDetailSchema,
  installationPreferencesSchema,
  libraryMembershipSchema,
  librarySchema,
  opmlImportReportSchema,
  pollingScheduleSchema,
  readerArticleSchema,
  readerItemSchema,
  refreshFeedResponseSchema,
  searchResultsSchema,
  subscriptionListSchema,
  serviceMetaSchema,
  type AuthStatus,
  type CreateSubscriptionResponse,
  type Digest,
  type FeedDetail,
  type InstallationPreferences,
  type Library,
  type LibraryMembership,
  type OpmlImportReport,
  type PollingIntervalMinutes,
  type PollingSchedule,
  type ReaderArticle,
  type ReaderItem,
  type RefreshFeedResponse,
  type SearchResults,
  type SubscriptionList,
  type ServiceMeta,
} from '../shared/api.js'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterSeconds: number | undefined

  constructor(status: number, code: string, retryAfterSeconds?: number) {
    super(`Request failed with ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
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

const UNAUTHENTICATED = 'unauthenticated'

const REQUEST_TIMEOUT_MS = 30_000

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
    credentials: 'same-origin',
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (response.ok) return response

  const code = await errorCode(response)

  if (code === UNAUTHENTICATED && path !== STATUS_PATH) sessionEnded?.()

  throw new ApiError(response.status, code, retryAfterOf(response))
}

function post(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function status(response: Response): Promise<AuthStatus> {
  return authStatusSchema.parse(await response.json())
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return status(await request(STATUS_PATH))
}

export async function claimInstallation(setupSecret: string, password: string): Promise<AuthStatus> {
  return status(await post('/api/auth/setup', { setupSecret, password, timezone: detectedTimezone() }))
}

function detectedTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

export async function signIn(password: string): Promise<AuthStatus> {
  return status(await post('/api/auth/session', { password }))
}

export async function signOut(): Promise<void> {
  await request('/api/auth/session', { method: 'DELETE' })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthStatus> {
  return status(await post('/api/auth/password', { currentPassword, newPassword }))
}

export async function subscribeToFeed(url: string): Promise<CreateSubscriptionResponse> {
  const response = await post('/api/subscriptions', { url })
  return createSubscriptionResponseSchema.parse(await response.json())
}

export async function importOpml(opml: string): Promise<OpmlImportReport> {
  const response = await post('/api/subscriptions/import', { opml })
  return opmlImportReportSchema.parse(await response.json())
}

export async function refreshFeed(feedId: number): Promise<RefreshFeedResponse> {
  const response = await post(`/api/feeds/${feedId}/refresh`, undefined)
  return refreshFeedResponseSchema.parse(await response.json())
}

export async function fetchSubscriptions(): Promise<SubscriptionList> {
  const response = await request('/api/feeds')
  return subscriptionListSchema.parse(await response.json())
}

export async function fetchFeedDetail(feedId: number): Promise<FeedDetail> {
  const response = await request(`/api/feeds/${feedId}`)
  return feedDetailSchema.parse(await response.json())
}

export async function updatePollingInterval(
  feedId: number,
  pollingIntervalMinutes: PollingIntervalMinutes,
): Promise<PollingSchedule> {
  const response = await request(`/api/feeds/${feedId}/interval`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pollingIntervalMinutes }),
  })
  return pollingScheduleSchema.parse(await response.json())
}

/** Polling stops and the Feed's items leave the Digest; saved items stay in the Library. */
export async function unsubscribeFromFeed(feedId: number): Promise<void> {
  await request(`/api/feeds/${feedId}`, { method: 'DELETE' })
}

export async function fetchDigest(cursor?: string): Promise<Digest> {
  const response = await request(cursor ? `/api/digest?cursor=${encodeURIComponent(cursor)}` : '/api/digest')
  return digestSchema.parse(await response.json())
}

/** Searches retained reading metadata only; results newest first. */
export async function fetchSearchResults(query: string): Promise<SearchResults> {
  const response = await request(`/api/search?q=${encodeURIComponent(query)}`)
  return searchResultsSchema.parse(await response.json())
}

export async function fetchLibrary(cursor?: string): Promise<Library> {
  const response = await request(cursor ? `/api/library?cursor=${encodeURIComponent(cursor)}` : '/api/library')
  return librarySchema.parse(await response.json())
}

export async function saveToLibrary(feedItemId: number): Promise<LibraryMembership> {
  const response = await request(`/api/library/${feedItemId}`, { method: 'PUT' })
  return libraryMembershipSchema.parse(await response.json())
}

export async function unsaveFromLibrary(feedItemId: number): Promise<LibraryMembership> {
  const response = await request(`/api/library/${feedItemId}`, { method: 'DELETE' })
  return libraryMembershipSchema.parse(await response.json())
}

export async function fetchReaderItem(feedItemId: number): Promise<ReaderItem> {
  const response = await request(`/api/items/${feedItemId}`)
  return readerItemSchema.parse(await response.json())
}

export async function fetchReaderArticle(feedItemId: number): Promise<ReaderArticle> {
  const response = await request(`/api/items/${feedItemId}/reader`)
  return readerArticleSchema.parse(await response.json())
}

export async function fetchInstallationPreferences(): Promise<InstallationPreferences> {
  const response = await request('/api/settings')
  return installationPreferencesSchema.parse(await response.json())
}

export async function updateInstallationTimezone(timezone: string): Promise<InstallationPreferences> {
  const response = await request('/api/settings/timezone', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timezone }),
  })
  return installationPreferencesSchema.parse(await response.json())
}

export async function fetchServiceMeta(): Promise<ServiceMeta> {
  const response = await request('/api/meta')
  return serviceMetaSchema.parse(await response.json())
}

async function errorCode(response: Response): Promise<string> {
  try {
    return apiErrorSchema.parse(await response.json()).error.code
  } catch {
    return 'unknown'
  }
}

function retryAfterOf(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}
