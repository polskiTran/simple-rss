import {
  apiErrorSchema,
  authStatusSchema,
  createSubscriptionResponseSchema,
  digestSchema,
  feedDetailSchema,
  installationPreferencesSchema,
  opmlImportReportSchema,
  pollingScheduleSchema,
  refreshFeedResponseSchema,
  subscriptionListSchema,
  serviceMetaSchema,
  type AuthStatus,
  type CreateSubscriptionResponse,
  type Digest,
  type FeedDetail,
  type InstallationPreferences,
  type OpmlImportReport,
  type PollingIntervalMinutes,
  type PollingSchedule,
  type RefreshFeedResponse,
  type SubscriptionList,
  type ServiceMeta,
} from '../shared/api.js'

/**
 * Same-origin JSON calls, validated against the schemas the server answers
 * with. The client never trusts a response shape it has not parsed.
 *
 * Network loss surfaces as a rejected promise, which views render as an
 * explicit unavailable state — the application never pretends to be offline.
 */

/** What the server said went wrong, so a view can say something specific. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** Seconds the server asked the Owner to wait, when it asked at all. */
  readonly retryAfterSeconds: number | undefined

  constructor(status: number, code: string, retryAfterSeconds?: number) {
    super(`Request failed with ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/**
 * Told whenever the server stops recognising this device.
 *
 * A session can end between one request and the next — it idles out, or the
 * password changes on the other device — and the shell has to notice without
 * every view learning how to handle it.
 */
type SessionEndedHandler = () => void

let sessionEnded: SessionEndedHandler | undefined

export function onSessionEnded(handler: SessionEndedHandler): () => void {
  sessionEnded = handler
  return () => {
    if (sessionEnded === handler) sessionEnded = undefined
  }
}

const STATUS_PATH = '/api/auth/status'

/**
 * The code the server uses for "you are not signed in", as opposed to
 * `invalid_credentials`, which is a password the Owner got wrong while still
 * holding a perfectly good session.
 */
const UNAUTHENTICATED = 'unauthenticated'

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
    // The session cookie is `SameSite=Strict`; this is the same rule stated at
    // the fetch layer, so the credential can never leave the origin.
    credentials: 'same-origin',
  })

  if (response.ok) return response

  const code = await errorCode(response)

  // The status poll asks whether there is a session, so being told there is
  // not is its answer rather than news.
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

/**
 * The claiming device's own zone, offered once so the installation timezone is
 * detected during setup rather than defaulting to UTC. Absent rather than
 * wrong when the browser cannot say.
 */
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

/** One deliberate repeat retrieval of a Feed — the manual retry action. */
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

export async function fetchDigest(): Promise<Digest> {
  const response = await request('/api/digest')
  return digestSchema.parse(await response.json())
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
