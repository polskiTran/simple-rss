import { lookup } from 'node:dns/promises'
import { classifyAddress, isBenchmarkIpv4Literal, unbracket, type AddressClass } from './addresses.js'

/** The signal lets bounded adapters stop waiting at the retrieval deadline. */
export type ResolveAddresses = (hostname: string, signal: AbortSignal) => Promise<readonly string[]>

export interface DestinationPolicy {
  readonly resolve: ResolveAddresses
  readonly canonicalOrigin: URL
  readonly allowBenchmarkAddresses?: boolean
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
  /**
   * Every address the name answered with. Each one is public, or in
   * 198.18.0.0/15 when the dev opt-in is on. The socket may connect only to
   * these addresses for this hop.
   */
  readonly addresses: readonly string[]
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
 * rebinding attempt. The dev opt-in may also accept 198.18.0.0/15, and no
 * other non-public range. This is the hop's only resolution: the socket is
 * pinned to the approved addresses. Each redirect hop is validated by a
 * separate call.
 */
export async function validateDestination(
  candidate: string | URL,
  policy: DestinationPolicy,
  signal: AbortSignal,
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

  if (isSelf(url, policy.canonicalOrigin)) {
    return { ok: false, code: 'blocked_destination', reason: 'destination is this installation' }
  }

  if (isBlockedName(hostname)) {
    return { ok: false, code: 'blocked_destination', reason: 'local network name' }
  }

  const literal = classifyAddress(hostname)
  if (literal !== 'invalid') {
    return allowsAddress(hostname, literal, policy)
      ? { ok: true, url, addresses: [hostname] }
      : { ok: false, code: 'blocked_destination', reason: `${literal} address` }
  }

  let addresses: readonly string[]
  try {
    addresses = await policy.resolve(hostname, signal)
  } catch (error) {
    if (error instanceof ResolutionCapacityError) {
      return { ok: false, code: 'busy', reason: 'DNS lookup capacity is full' }
    }
    return { ok: false, code: 'unresolvable_host', reason: 'host did not resolve' }
  }

  if (addresses.length === 0) {
    return { ok: false, code: 'unresolvable_host', reason: 'host did not resolve' }
  }

  for (const address of addresses) {
    const classification = classifyAddress(address)
    if (!allowsAddress(address, classification, policy)) {
      return { ok: false, code: 'blocked_destination', reason: `host resolves to a ${classification} address` }
    }
  }

  return { ok: true, url, addresses }
}

function allowsAddress(address: string, classification: AddressClass, policy: DestinationPolicy): boolean {
  if (classification === 'public') return true
  return policy.allowBenchmarkAddresses === true && isBenchmarkIpv4Literal(address)
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
function isSelf(url: URL, canonicalOrigin: URL): boolean {
  return (
    normaliseHostname(url.hostname) === normaliseHostname(canonicalOrigin.hostname) &&
    effectivePort(url) === effectivePort(canonicalOrigin)
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
