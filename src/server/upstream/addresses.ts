import { isIP } from 'node:net'

/**
 * What an IP address is, as far as an outbound retrieval is concerned. Only
 * `public` may be connected to; every other class names a reason to refuse.
 */
export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'multicast'
  | 'unspecified'
  | 'reserved'
  | 'invalid'

/**
 * Classifies one resolved address.
 *
 * The dangerous destinations are not only the obvious `127.0.0.1`: cloud
 * metadata lives on a link-local address, container networks are private, and
 * an IPv6 address can carry an IPv4 one inside it. A mapped, 6to4, or NAT64
 * address is therefore unwrapped and judged by what it really reaches, since a
 * socket opened to `::ffff:127.0.0.1` lands on the loopback interface exactly
 * as `127.0.0.1` would.
 *
 * Textual tricks (`0x7f000001`, `127.1`) are not addresses at all here. They
 * are hostnames as far as this function is concerned, and the resolver turns
 * them into real addresses that then pass through this same classification.
 */
export function classifyAddress(address: string): AddressClass {
  const family = isIP(address)
  if (family === 4) {
    const bytes = parseIpv4(address)
    return bytes ? classifyIpv4(bytes) : 'invalid'
  }
  if (family === 6) {
    const bytes = parseIpv6(address)
    return bytes ? classifyIpv6(bytes) : 'invalid'
  }
  return 'invalid'
}

/**
 * A URL hostname as an address: `[::1]` is the same destination as `::1`, and
 * every rule here is written for the unbracketed form.
 */
export function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/** Whether a retrieval may open a connection to this address. */
export function isPublicAddress(address: string): boolean {
  return classifyAddress(address) === 'public'
}

function classifyIpv4(bytes: Uint8Array): AddressClass {
  const [a = 0, b = 0, c = 0, d = 0] = bytes

  if (a === 0) return b === 0 && c === 0 && d === 0 ? 'unspecified' : 'reserved'
  if (a === 127) return 'loopback'
  if (a === 10) return 'private'
  if (a === 172 && b >= 16 && b <= 31) return 'private'
  if (a === 192 && b === 168) return 'private'
  if (a === 169 && b === 254) return 'link-local'
  // Carrier-grade NAT: shared address space that reaches the provider's
  // network rather than the public internet.
  if (a === 100 && b >= 64 && b <= 127) return 'reserved'
  // IETF protocol assignments and documentation ranges.
  if (a === 192 && b === 0 && c === 0) return d === 9 || d === 10 ? 'public' : 'reserved'
  if (a === 192 && b === 0 && c === 2) return 'reserved'
  if (a === 192 && b === 88 && c === 99) return 'reserved'
  if (a === 198 && b === 51 && c === 100) return 'reserved'
  if (a === 203 && b === 0 && c === 113) return 'reserved'
  if (a === 198 && (b === 18 || b === 19)) return 'reserved'
  if (a >= 224 && a <= 239) return 'multicast'
  // 240/4, which carries the broadcast address at its top.
  if (a >= 240) return 'reserved'

  return 'public'
}

function classifyIpv6(bytes: Uint8Array): AddressClass {
  if (allZero(bytes, 0, 16)) return 'unspecified'
  if (allZero(bytes, 0, 15) && bytes[15] === 1) return 'loopback'
  if (bytes[0] === 0xff) return 'multicast'
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return 'link-local'
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return 'private'

  // ::ffff:0:0/96 — the address an IPv4 socket wears on a dual-stack host.
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4(bytes.subarray(12, 16))
  }
  // 64:ff9b::/96 — globally reachable NAT64; judge the IPv4 destination.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes, 4, 12)) {
    return classifyIpv4(bytes.subarray(12, 16))
  }
  // 64:ff9b:1::/48 is a local-use translation prefix and is not global.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes[4] === 0x00 &&
    bytes[5] === 0x01
  ) {
    return 'reserved'
  }
  // 2002::/16 — 6to4; judge the public IPv4 endpoint it embeds.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return classifyIpv4(bytes.subarray(2, 6))
  }
  // Non-global allocations inside the otherwise global 2000::/3 space.
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return 'reserved' // Teredo
    if (bytes[2] === 0x00 && bytes[3] === 0x02 && allZero(bytes, 4, 6)) return 'reserved' // benchmarking
    if (bytes[2] === 0x00 && ((bytes[3] ?? 0) & 0xf0) === 0x10) return 'reserved' // deprecated ORCHID
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return 'reserved' // documentation
  }
  if (bytes[0] === 0x3f && ((bytes[1] ?? 0) & 0xf0) === 0xf0) return 'reserved' // documentation

  // 100::/64 discard-only and ::/96 IPv4-compatible.
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && allZero(bytes, 2, 8)) return 'reserved'
  if (allZero(bytes, 0, 12)) return 'reserved'

  // IANA currently allocates ordinary global unicast from 2000::/3. Anything
  // else not handled above is non-global and must fail closed.
  return ((bytes[0] ?? 0) & 0xe0) === 0x20 ? 'public' : 'reserved'
}

function allZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

/** Only ever called on text `isIP` has already accepted as dotted-quad. */
function parseIpv4(address: string): Uint8Array | undefined {
  const parts = address.split('.')
  if (parts.length !== 4) return undefined

  const bytes = new Uint8Array(4)
  for (let index = 0; index < 4; index += 1) {
    const value = Number(parts[index])
    if (!Number.isInteger(value) || value < 0 || value > 255) return undefined
    bytes[index] = value
  }
  return bytes
}

/**
 * Expands an IPv6 literal into its sixteen bytes, including the `::` run and a
 * trailing dotted-quad. Only ever called on text `isIP` has already accepted,
 * so this handles the shapes rather than re-validating them.
 */
function parseIpv6(address: string): Uint8Array | undefined {
  const literal = withoutTrailingIpv4(address)
  if (literal === undefined) return undefined

  const [head = '', tail, ...rest] = literal.split('::')
  if (rest.length > 0) return undefined

  const leading = head === '' ? [] : head.split(':')
  const trailing = tail === undefined || tail === '' ? [] : tail.split(':')
  // The `::` run is however many of the eight groups the two sides leave over.
  const gap = 8 - leading.length - trailing.length
  if (tail === undefined ? gap !== 0 : gap < 0) return undefined

  const bytes = new Uint8Array(16)
  let offset = 0

  const write = (groups: readonly string[]): boolean => {
    for (const group of groups) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return false
      const value = Number.parseInt(group, 16)
      bytes[offset] = value >> 8
      bytes[offset + 1] = value & 0xff
      offset += 2
    }
    return true
  }

  if (!write(leading)) return undefined
  offset += gap * 2
  if (!write(trailing)) return undefined

  return bytes
}

/**
 * Rewrites a trailing dotted-quad (`::ffff:127.0.0.1`) as the two hexadecimal
 * groups it stands for, so the expansion above only deals with one notation.
 */
function withoutTrailingIpv4(address: string): string | undefined {
  if (!address.includes('.')) return address

  const start = address.lastIndexOf(':') + 1
  const quad = parseIpv4(address.slice(start))
  if (!quad) return undefined

  const high = (((quad[0] ?? 0) << 8) | (quad[1] ?? 0)).toString(16)
  const low = (((quad[2] ?? 0) << 8) | (quad[3] ?? 0)).toString(16)
  return `${address.slice(0, start)}${high}:${low}`
}
