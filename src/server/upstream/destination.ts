import { lookup } from 'node:dns/promises'
import { classifyAddress, isBenchmarkIpv4Literal, unbracket, type AddressClass } from './addresses.js'

export type ResolveAddresses = (hostname: string, signal: AbortSignal) => Promise<readonly string[]>

export interface DestinationPolicy {
  readonly resolve: ResolveAddresses
  readonly canonicalOrigin: URL
  readonly allowBenchmarkAddresses?: boolean
}

export const systemResolver: ResolveAddresses = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map((answer) => answer.address)
}

export type DestinationFailureCode = 'invalid_url' | 'blocked_destination' | 'unresolvable_host' | 'busy'

export interface AllowedDestination {
  readonly ok: true
  readonly url: URL
  readonly addresses: readonly string[]
}

export interface RefusedDestination {
  readonly ok: false
  readonly code: DestinationFailureCode
  readonly reason: string
}

export type DestinationVerdict = AllowedDestination | RefusedDestination

const BLOCKED_SUFFIXES = ['localhost', 'local', 'internal', 'arpa']

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

function normaliseHostname(hostname: string): string {
  const host = unbracket(hostname)
  return host.endsWith('.') ? host.slice(0, -1) : host
}

function isBlockedName(hostname: string): boolean {
  return BLOCKED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

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
