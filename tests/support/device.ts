import { SESSION_COOKIE } from '../../src/server/http/session-cookie.js'
import { USER_PASSWORD, SETUP_SECRET, type TestService } from './service-harness.js'

export interface DeviceOptions {
  /** The address a proxy would report for this device, for rate-limit tests. */
  readonly address?: string
  /** Overrides the `Origin` header, so a test can forge or omit it. */
  readonly origin?: string | null
}

/**
 * One browser talking to the installation: it keeps its own cookie jar and
 * sends the headers a browser sends.
 */
export class Device {
  readonly #service: TestService
  readonly #options: DeviceOptions
  #cookie: string | undefined

  constructor(service: TestService, options: DeviceOptions = {}) {
    this.#service = service
    this.#options = options
  }

  get sessionToken(): string | undefined {
    return this.#cookie
  }

  /** Puts a token this device was never given into its jar. */
  present(token: string | undefined): this {
    this.#cookie = token
    return this
  }

  get(path: string): Promise<Response> {
    return this.#send(path, 'GET')
  }

  post(path: string, body?: unknown): Promise<Response> {
    return this.#send(path, 'POST', body)
  }

  put(path: string, body?: unknown): Promise<Response> {
    return this.#send(path, 'PUT', body)
  }

  delete(path: string): Promise<Response> {
    return this.#send(path, 'DELETE')
  }

  status(): Promise<Response> {
    return this.get('/api/auth/status')
  }

  claim(password: string = USER_PASSWORD, setupSecret: string = SETUP_SECRET): Promise<Response> {
    return this.post('/api/auth/setup', { setupSecret, password })
  }

  signIn(password: string = USER_PASSWORD): Promise<Response> {
    return this.post('/api/auth/session', { password })
  }

  signOut(): Promise<Response> {
    return this.delete('/api/auth/session')
  }

  changePassword(currentPassword: string, newPassword: string): Promise<Response> {
    return this.post('/api/auth/password', { currentPassword, newPassword })
  }

  async #send(path: string, method: string, body?: unknown): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' })

    const origin = this.#options.origin === undefined ? new URL(this.#service.url).origin : this.#options.origin
    if (origin !== null) headers.set('origin', origin)
    if (this.#options.address) headers.set('x-forwarded-for', this.#options.address)
    if (this.#cookie) headers.set('cookie', `${SESSION_COOKIE}=${this.#cookie}`)
    if (body !== undefined) headers.set('content-type', 'application/json')

    const response = await this.#service.fetch(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    this.#absorb(response)
    return response
  }

  #absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = raw.split(';')
      const separator = pair.indexOf('=')
      if (pair.slice(0, separator).trim() !== SESSION_COOKIE) continue

      const value = pair.slice(separator + 1).trim()
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))
      this.#cookie = expired || value === '' ? undefined : value
    }
  }
}

/** A device that has already claimed the installation and is signed in. */
export async function claimedDevice(service: TestService, options: DeviceOptions = {}): Promise<Device> {
  const device = new Device(service, options)
  const response = await device.claim()
  if (response.status !== 201) {
    throw new Error(`could not claim the installation: ${response.status} ${await response.text()}`)
  }
  return device
}
