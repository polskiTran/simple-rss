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
    return bytes ? classifyIpv4(bytes) : 'invalid'
  }
  if (family === 6) {
    const bytes = parseIpv6(address)
    return bytes ? classifyIpv6(bytes) : 'invalid'
  }
  return 'invalid'
}

export function isBenchmarkIpv4Literal(address: string): boolean {
  if (isIP(address) !== 4) return false
  const bytes = parseIpv4(address)
  if (!bytes) return false
  return isBenchmarkIpv4(bytes[0] ?? 0, bytes[1] ?? 0)
}

function isBenchmarkIpv4(first: number, second: number): boolean {
  return first === 198 && (second === 18 || second === 19)
}

export function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function classifyIpv4(bytes: Uint8Array): AddressClass {
  const [a = 0, b = 0, c = 0, d = 0] = bytes

  if (a === 0) return b === 0 && c === 0 && d === 0 ? 'unspecified' : 'reserved'
  if (a === 127) return 'loopback'
  if (a === 10) return 'private'
  if (a === 172 && b >= 16 && b <= 31) return 'private'
  if (a === 192 && b === 168) return 'private'
  if (a === 169 && b === 254) return 'link-local'
  if (a === 100 && b >= 64 && b <= 127) return 'reserved'
  if (a === 192 && b === 0 && c === 0) return d === 9 || d === 10 ? 'public' : 'reserved'
  if (a === 192 && b === 0 && c === 2) return 'reserved'
  if (a === 192 && b === 88 && c === 99) return 'reserved'
  if (a === 198 && b === 51 && c === 100) return 'reserved'
  if (a === 203 && b === 0 && c === 113) return 'reserved'
  if (isBenchmarkIpv4(a, b)) return 'reserved'
  if (a >= 224 && a <= 239) return 'multicast'
  if (a >= 240) return 'reserved'

  return 'public'
}

function classifyIpv6(bytes: Uint8Array): AddressClass {
  if (allZero(bytes, 0, 16)) return 'unspecified'
  if (allZero(bytes, 0, 15) && bytes[15] === 1) return 'loopback'
  if (bytes[0] === 0xff) return 'multicast'
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return 'link-local'
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return 'private'

  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4(bytes.subarray(12, 16))
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(bytes, 4, 12)) {
    return classifyIpv4(bytes.subarray(12, 16))
  }
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
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return classifyIpv4(bytes.subarray(2, 6))
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return 'reserved'
    if (bytes[2] === 0x00 && bytes[3] === 0x02 && allZero(bytes, 4, 6)) return 'reserved'
    if (bytes[2] === 0x00 && ((bytes[3] ?? 0) & 0xf0) === 0x10) return 'reserved'
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return 'reserved'
  }
  if (bytes[0] === 0x3f && ((bytes[1] ?? 0) & 0xf0) === 0xf0) return 'reserved'

  if (bytes[0] === 0x01 && bytes[1] === 0x00 && allZero(bytes, 2, 8)) return 'reserved'
  if (allZero(bytes, 0, 12)) return 'reserved'

  return ((bytes[0] ?? 0) & 0xe0) === 0x20 ? 'public' : 'reserved'
}

function allZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
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
