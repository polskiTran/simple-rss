import { lookup } from 'node:dns/promises'
import { classifyAddress, unbracket } from './addresses.js'

/**
 * Turns a hostname into every address it currently answers with. Injected so
 * tests can describe a resolver's answer, including one that changes between
 * calls, without depending on real DNS.
 */
export type ResolveAddresses = (hostname: string) => Promise<readonly string[]>

export interface DestinationPolicy {
  readonly resolve: ResolveAddresses
  /**
   * This installation's own origins. Retrieving one of them would let an
   * outside URL steer the reader back into its own API, so they are refused
   * even though they are perfectly ordinary public addresses.
   */
  readonly self?: readonly string[]
}

/**
 * Every address the name currently answers with. All of them are asked for,
 * not just the first, because a name only has to answer with one private
 * address for a connection to reach somewhere it should not.
 */
export const systemResolver: ResolveAddresses = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map((answer) => answer.address)
}

export type DestinationFailureCode = 'invalid_url' | 'blocked_destination' | 'unresolvable_host'

export interface AllowedDestination {
  readonly ok: true
  readonly url: URL
  /** The name asked of the resolver, without a trailing dot or brackets. */
  readonly hostname: string
  /** Every address the name answered with, each already judged public. */
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
 * Names that never belong to a Feed but do belong to something inside the
 * deployment. Blocking them by name matters because the address behind them is
 * only discovered after a resolver has been asked, and some of them resolve
 * differently on the host than they do here.
 */
const BLOCKED_SUFFIXES = ['localhost', 'local', 'internal', 'arpa']

/**
 * Decides whether one URL may be retrieved, before any connection is opened.
 *
 * The checks run cheapest-first and each rejects on its own: the scheme, then
 * credentials, then the name, then — only for a name that survives all of
 * that — the addresses it resolves to. Every address must be public, because a
 * name that answers with one public and one private address is the ordinary
 * shape of a rebinding attempt rather than a coincidence.
 *
 * Redirects are not followed here. Each hop is a separate destination and is
 * validated by a separate call, so a public first hop cannot vouch for a
 * private second one.
 */
export async function validateDestination(
  candidate: string | URL,
  policy: DestinationPolicy,
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

  // An address literal is its own answer; asking a resolver about it would
  // only add a way to be lied to.
  const literal = classifyAddress(hostname)
  if (literal !== 'invalid') {
    return literal === 'public'
      ? { ok: true, url, hostname, addresses: [hostname] }
      : { ok: false, code: 'blocked_destination', reason: `${literal} address` }
  }

  let addresses: readonly string[]
  try {
    addresses = await policy.resolve(hostname)
  } catch {
    return { ok: false, code: 'unresolvable_host', reason: 'host did not resolve' }
  }

  if (addresses.length === 0) {
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

/**
 * `URL` already lowercases a hostname and brackets an IPv6 literal. A trailing
 * dot is left alone, though, and `example.com.` must not slip past a rule
 * written for `example.com`.
 */
function normaliseHostname(hostname: string): string {
  const host = unbracket(hostname)
  return host.endsWith('.') ? host.slice(0, -1) : host
}

function isBlockedName(hostname: string): boolean {
  return BLOCKED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

/**
 * Compares host and port but not scheme, because the same installation answers
 * on both behind a TLS-terminating proxy. A different port on the same name is
 * a different service and stays allowed.
 */
function isSelf(url: URL, self: readonly string[] | undefined): boolean {
  if (!self || self.length === 0) return false

  return self.some((entry) => {
    const host = entry.includes('://') ? safeHost(entry) : entry.trim().toLowerCase()
    return host !== undefined && host !== '' && host === url.host
  })
}

function safeHost(origin: string): string | undefined {
  try {
    return new URL(origin).host
  } catch {
    return undefined
  }
}
