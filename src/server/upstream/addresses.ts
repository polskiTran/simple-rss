import { isIP } from 'node:net'

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'multicast'
  | 'unspecified'
  | 'reserved'
  | 'invalid'

export function classifyAddress(address: string): AddressClass {
  const family = isIP(address)
  if (family === 4) {
    const bytes = parseIpv4(address)
    return bytes ? classifyIn(IPV4, bytes) : 'invalid'
  }
  if (family === 6) {
    const bytes = parseIpv6(address)
    return bytes ? classifyIn(IPV6, bytes) : 'invalid'
  }
  return 'invalid'
}

export function isBenchmarkIpv4Literal(address: string): boolean {
  if (isIP(address) !== 4) return false
  const bytes = parseIpv4(address)
  return bytes !== undefined && contains(BENCHMARKING_IPV4_PREFIX, bytes)
}

export function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

type Classified = Exclude<AddressClass, 'invalid'>

interface ClassifiedRange {
  readonly cidr: string
  readonly name: string
  readonly class: Classified
}

interface EmbeddingRange {
  readonly cidr: string
  readonly name: string
  readonly embedsIpv4At: number
}

interface Prefix {
  readonly bytes: Uint8Array
  readonly length: number
}

interface AddressTable<Range> {
  readonly unlisted: Classified
  readonly ranges: readonly (Range & { readonly prefix: Prefix })[]
}

const BENCHMARKING_IPV4 = '198.18.0.0/15'

const BENCHMARKING_IPV4_PREFIX = prefixOf(BENCHMARKING_IPV4, parseIpv4)

const IPV4 = table<ClassifiedRange>(parseIpv4, 'public', [
  { cidr: '0.0.0.0/8', name: 'This network', class: 'reserved' },
  { cidr: '0.0.0.0/32', name: 'This host on this network', class: 'unspecified' },
  { cidr: '10.0.0.0/8', name: 'Private-Use', class: 'private' },
  { cidr: '100.64.0.0/10', name: 'Shared Address Space', class: 'reserved' },
  { cidr: '127.0.0.0/8', name: 'Loopback', class: 'loopback' },
  { cidr: '169.254.0.0/16', name: 'Link Local', class: 'link-local' },
  { cidr: '172.16.0.0/12', name: 'Private-Use', class: 'private' },
  { cidr: '192.0.0.0/24', name: 'IETF Protocol Assignments', class: 'reserved' },
  { cidr: '192.0.0.9/32', name: 'Port Control Protocol Anycast', class: 'public' },
  { cidr: '192.0.0.10/32', name: 'Traversal Using Relays around NAT Anycast', class: 'public' },
  { cidr: '192.0.2.0/24', name: 'Documentation (TEST-NET-1)', class: 'reserved' },
  { cidr: '192.88.99.0/24', name: 'Deprecated (6to4 Relay Anycast)', class: 'reserved' },
  { cidr: '192.168.0.0/16', name: 'Private-Use', class: 'private' },
  { cidr: BENCHMARKING_IPV4, name: 'Benchmarking', class: 'reserved' },
  { cidr: '198.51.100.0/24', name: 'Documentation (TEST-NET-2)', class: 'reserved' },
  { cidr: '203.0.113.0/24', name: 'Documentation (TEST-NET-3)', class: 'reserved' },
  { cidr: '224.0.0.0/4', name: 'Multicast', class: 'multicast' },
  { cidr: '240.0.0.0/4', name: 'Reserved, including Limited Broadcast', class: 'reserved' },
])

const IPV6 = table<ClassifiedRange | EmbeddingRange>(parseIpv6, 'reserved', [
  { cidr: '::/128', name: 'Unspecified Address', class: 'unspecified' },
  { cidr: '::1/128', name: 'Loopback Address', class: 'loopback' },
  { cidr: '::/96', name: 'Deprecated IPv4-Compatible Address', class: 'reserved' },
  { cidr: '::ffff:0:0/96', name: 'IPv4-mapped Address', embedsIpv4At: 12 },
  { cidr: '64:ff9b::/96', name: 'IPv4-IPv6 Translation', embedsIpv4At: 12 },
  { cidr: '64:ff9b:1::/48', name: 'IPv4-IPv6 Translation, local use', class: 'reserved' },
  { cidr: '100::/64', name: 'Discard-Only Address Block', class: 'reserved' },
  { cidr: '2000::/3', name: 'Global Unicast', class: 'public' },
  { cidr: '2001::/32', name: 'TEREDO', class: 'reserved' },
  { cidr: '2001:2::/48', name: 'Benchmarking', class: 'reserved' },
  { cidr: '2001:10::/28', name: 'Deprecated (previously ORCHID)', class: 'reserved' },
  { cidr: '2001:db8::/32', name: 'Documentation', class: 'reserved' },
  { cidr: '2002::/16', name: '6to4', embedsIpv4At: 2 },
  { cidr: '3ff0::/12', name: 'Unassigned, including Documentation 3fff::/20', class: 'reserved' },
  { cidr: 'fc00::/7', name: 'Unique-Local', class: 'private' },
  { cidr: 'fe80::/10', name: 'Link-Local Unicast', class: 'link-local' },
  { cidr: 'ff00::/8', name: 'Multicast', class: 'multicast' },
])

function classifyIn<Range extends ClassifiedRange | EmbeddingRange>(
  addresses: AddressTable<Range>,
  bytes: Uint8Array,
): Classified {
  let narrowest: AddressTable<Range>['ranges'][number] | undefined
  for (const range of addresses.ranges) {
    if (contains(range.prefix, bytes) && range.prefix.length > (narrowest?.prefix.length ?? -1)) narrowest = range
  }
  if (narrowest === undefined) return addresses.unlisted
  if ('class' in narrowest) return narrowest.class
  return classifyIn(IPV4, bytes.subarray(narrowest.embedsIpv4At, narrowest.embedsIpv4At + 4))
}

function table<Range extends ClassifiedRange | EmbeddingRange>(
  parse: (address: string) => Uint8Array | undefined,
  unlisted: Classified,
  ranges: readonly Range[],
): AddressTable<Range> {
  return { unlisted, ranges: ranges.map((range) => ({ ...range, prefix: prefixOf(range.cidr, parse) })) }
}

function prefixOf(cidr: string, parse: (address: string) => Uint8Array | undefined): Prefix {
  const [address = '', bits = ''] = cidr.split('/')
  const bytes = parse(address)
  const length = Number(bits)
  if (bytes === undefined || !Number.isInteger(length) || length < 0 || length > bytes.length * 8) {
    throw new Error(`${cidr} is not a CIDR prefix`)
  }
  const hostBits = (index: number) => 0xff >> Math.min(8, Math.max(0, length - index * 8))
  if (bytes.some((byte, index) => (byte & hostBits(index)) !== 0)) {
    throw new Error(`${cidr} sets bits past its prefix length`)
  }
  return { bytes, length }
}

function contains(prefix: Prefix, bytes: Uint8Array): boolean {
  if (bytes.length !== prefix.bytes.length) return false
  const whole = prefix.length >> 3
  for (let index = 0; index < whole; index += 1) {
    if (bytes[index] !== prefix.bytes[index]) return false
  }
  const partial = prefix.length & 7
  if (partial === 0) return true
  const mask = (0xff << (8 - partial)) & 0xff
  return ((bytes[whole] ?? 0) & mask) === ((prefix.bytes[whole] ?? 0) & mask)
}

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

function parseIpv6(address: string): Uint8Array | undefined {
  const literal = withoutTrailingIpv4(address)
  if (literal === undefined) return undefined

  const [head = '', tail, ...rest] = literal.split('::')
  if (rest.length > 0) return undefined

  const leading = head === '' ? [] : head.split(':')
  const trailing = tail === undefined || tail === '' ? [] : tail.split(':')
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

function withoutTrailingIpv4(address: string): string | undefined {
  if (!address.includes('.')) return address

  const start = address.lastIndexOf(':') + 1
  const quad = parseIpv4(address.slice(start))
  if (!quad) return undefined

  const high = (((quad[0] ?? 0) << 8) | (quad[1] ?? 0)).toString(16)
  const low = (((quad[2] ?? 0) << 8) | (quad[3] ?? 0)).toString(16)
  return `${address.slice(0, start)}${high}:${low}`
}
