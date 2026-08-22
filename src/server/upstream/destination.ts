import { lookup } from 'node:dns/promises'
import { classifyAddress, unbracket } from './addresses.js'

/** The signal lets bounded adapters stop waiting at the retrieval deadline. */
export type ResolveAddresses = (hostname: string, signal?: AbortSignal) => Promise<readonly string[]>

export interface DestinationPolicy {
  readonly resolve: ResolveAddresses
  /** This installation's canonical public origin. */
  readonly self: URL
}

/** Asks for every address, not just the first: one private answer must refuse the name. */
export const systemResolver: ResolveAddresses = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map((answer) => answer.address)
}

export type DestinationFailureCode = 'invalid_url' | 'blocked_destination' | 'unresolvable_host' | 'busy'

export interface AllowedDestination {
  readonly ok: true
  readonly url: URL
  /** The name asked of the resolver, without a trailing dot or brackets. */
  readonly hostname: string
  /** Every address the name answered with, each already judged public; a name that answered none is refused. */
  readonly addresses: readonly [string, ...string[]]
}

export interface RefusedDestination {
  readonly ok: false
  readonly code: DestinationFailureCode
  /** Safe for logs: names the rule, never the credentials or the query. */
  readonly reason: string
}

export type DestinationVerdict = AllowedDestination | RefusedDestination

/**
 * Deployment-internal name suffixes, blocked by name: some resolve differently
 * here than on the host, so the address check alone cannot catch them.
 */
const BLOCKED_SUFFIXES = ['localhost', 'local', 'internal', 'arpa']

/**
 * Validates one URL before any connection: scheme, credentials, name, then
 * every resolved address must be public — a mixed answer is the shape of a
 * rebinding attempt. Each redirect hop is validated by a separate call.
 */
export async function validateDestination(
  candidate: string | URL,
  policy: DestinationPolicy,
  signal?: AbortSignal,
): Promise<DestinationVerdict> {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, code: 'invalid_url', reason: 'unparseable URL' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'blocked_destination', reason: `unsupported scheme ${url.protocol}` }
  }

  if (url.username !== '' || url.password !== '') {
    return { ok: false, code: 'blocked_destination', reason: 'URL carries credentials' }
  }

  const hostname = normaliseHostname(url.hostname)
  if (hostname === '') {
    return { ok: false, code: 'invalid_url', reason: 'URL has no host' }
  }

  if (isSelf(url, policy.self)) {
    return { ok: false, code: 'blocked_destination', reason: 'destination is this installation' }
  }

  if (isBlockedName(hostname)) {
    return { ok: false, code: 'blocked_destination', reason: 'local network name' }
  }

  const literal = classifyAddress(hostname)
  if (literal !== 'invalid') {
    return literal === 'public'
      ? { ok: true, url, hostname, addresses: [hostname] }
      : { ok: false, code: 'blocked_destination', reason: `${literal} address` }
  }

  let addresses: readonly string[]
  try {
    addresses = signal ? await policy.resolve(hostname, signal) : await policy.resolve(hostname)
  } catch (error) {
    if (error instanceof ResolutionCapacityError) {
      return { ok: false, code: 'busy', reason: 'DNS lookup capacity is full' }
    }
    return { ok: false, code: 'unresolvable_host', reason: 'host did not resolve' }
  }

  if (!nonEmpty(addresses)) {
    return { ok: false, code: 'unresolvable_host', reason: 'host did not resolve' }
  }

  for (const address of addresses) {
    const classification = classifyAddress(address)
    if (classification !== 'public') {
      return { ok: false, code: 'blocked_destination', reason: `host resolves to a ${classification} address` }
    }
  }

  return { ok: true, url, hostname, addresses }
}

function nonEmpty<T>(values: readonly T[]): values is readonly [T, ...T[]] {
  return values.length > 0
}

/** `URL` leaves a trailing dot alone; `example.com.` must not slip past a rule for `example.com`. */
function normaliseHostname(hostname: string): string {
  const host = unbracket(hostname)
  return host.endsWith('.') ? host.slice(0, -1) : host
}

function isBlockedName(hostname: string): boolean {
  return BLOCKED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

/** Scheme is deliberately ignored: the public proxy may answer HTTPS outside and HTTP inside. */
function isSelf(url: URL, self: URL): boolean {
  return (
    normaliseHostname(url.hostname) === normaliseHostname(self.hostname) && effectivePort(url) === effectivePort(self)
  )
}

function effectivePort(url: URL): string {
  if (url.port !== '') return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

export class ResolutionCapacityError extends Error {
  constructor() {
    super('DNS lookup capacity is full')
    this.name = 'ResolutionCapacityError'
  }
}
