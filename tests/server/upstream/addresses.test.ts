import { describe, expect, it } from 'vitest'
import { classifyAddress, isBenchmarkIpv4Literal } from '../../../src/server/upstream/addresses.js'

describe('classifyAddress', () => {
  it('accepts ordinary public addresses', () => {
    expect(classifyAddress('93.184.216.34')).toBe('public')
    expect(classifyAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe('public')
  })

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['::1', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['fd00::1', 'private'],
    ['169.254.169.254', 'link-local'],
    ['fe80::1', 'link-local'],
    ['0.0.0.0', 'unspecified'],
    ['::', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['ff02::1', 'multicast'],
    ['100.64.0.1', 'reserved'],
    ['192.0.2.5', 'reserved'],
    ['198.51.100.5', 'reserved'],
    ['203.0.113.5', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['2001:db8::1', 'reserved'],
    ['2001::1', 'reserved'],
    ['100::1', 'reserved'],
    ['192.88.99.2', 'reserved'],
    ['64:ff9b:1::1', 'reserved'],
    ['100:0:0:1::1', 'reserved'],
    ['2001:2::1', 'reserved'],
    ['2001:10::1', 'reserved'],
    ['3fff::1', 'reserved'],
    ['5f00::1', 'reserved'],
    ['fec0::1', 'reserved'],
    ['4000::1', 'reserved'],
  ] as const)('classifies %s as %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected)
  })

  it.each([
    ['0.0.0.0/8', '0.0.0.1', 'reserved'],
    ['0.0.0.0/8', '0.255.255.255', 'reserved'],
    ['0.0.0.0/8', '1.0.0.0', 'public'],
    ['0.0.0.0/32', '0.0.0.0', 'unspecified'],
    ['0.0.0.0/32', '0.0.0.1', 'reserved'],
    ['10.0.0.0/8', '10.0.0.0', 'private'],
    ['10.0.0.0/8', '10.255.255.255', 'private'],
    ['10.0.0.0/8', '11.0.0.0', 'public'],
    ['100.64.0.0/10', '100.64.0.0', 'reserved'],
    ['100.64.0.0/10', '100.127.255.255', 'reserved'],
    ['100.64.0.0/10', '100.128.0.0', 'public'],
    ['127.0.0.0/8', '127.0.0.0', 'loopback'],
    ['127.0.0.0/8', '127.255.255.255', 'loopback'],
    ['127.0.0.0/8', '128.0.0.0', 'public'],
    ['169.254.0.0/16', '169.254.0.0', 'link-local'],
    ['169.254.0.0/16', '169.254.255.255', 'link-local'],
    ['169.254.0.0/16', '169.255.0.0', 'public'],
    ['172.16.0.0/12', '172.16.0.0', 'private'],
    ['172.16.0.0/12', '172.31.255.255', 'private'],
    ['172.16.0.0/12', '172.32.0.0', 'public'],
    ['192.0.0.0/24', '192.0.0.0', 'reserved'],
    ['192.0.0.0/24', '192.0.0.255', 'reserved'],
    ['192.0.0.0/24', '192.0.1.0', 'public'],
    ['192.0.0.9/32', '192.0.0.9', 'public'],
    ['192.0.0.9/32', '192.0.0.8', 'reserved'],
    ['192.0.0.10/32', '192.0.0.10', 'public'],
    ['192.0.0.10/32', '192.0.0.11', 'reserved'],
    ['192.0.2.0/24', '192.0.2.0', 'reserved'],
    ['192.0.2.0/24', '192.0.2.255', 'reserved'],
    ['192.0.2.0/24', '192.0.3.0', 'public'],
    ['192.88.99.0/24', '192.88.99.0', 'reserved'],
    ['192.88.99.0/24', '192.88.99.255', 'reserved'],
    ['192.88.99.0/24', '192.88.100.0', 'public'],
    ['192.168.0.0/16', '192.168.0.0', 'private'],
    ['192.168.0.0/16', '192.168.255.255', 'private'],
    ['192.168.0.0/16', '192.169.0.0', 'public'],
    ['198.18.0.0/15', '198.18.0.0', 'reserved'],
    ['198.18.0.0/15', '198.19.255.255', 'reserved'],
    ['198.18.0.0/15', '198.20.0.0', 'public'],
    ['198.51.100.0/24', '198.51.100.0', 'reserved'],
    ['198.51.100.0/24', '198.51.100.255', 'reserved'],
    ['198.51.100.0/24', '198.51.101.0', 'public'],
    ['203.0.113.0/24', '203.0.113.0', 'reserved'],
    ['203.0.113.0/24', '203.0.113.255', 'reserved'],
    ['203.0.113.0/24', '203.0.114.0', 'public'],
    ['224.0.0.0/4', '224.0.0.0', 'multicast'],
    ['224.0.0.0/4', '239.255.255.255', 'multicast'],
    ['224.0.0.0/4', '223.255.255.255', 'public'],
    ['240.0.0.0/4', '240.0.0.0', 'reserved'],
    ['240.0.0.0/4', '255.255.255.255', 'reserved'],
    ['240.0.0.0/4', '239.255.255.255', 'multicast'],
    ['::/128', '::', 'unspecified'],
    ['::/128', '::1', 'loopback'],
    ['::1/128', '::1', 'loopback'],
    ['::1/128', '::2', 'reserved'],
    ['::/96', '::2', 'reserved'],
    ['::/96', '::ffff:ffff', 'reserved'],
    ['::/96', '::1:0:0', 'reserved'],
    ['::ffff:0:0/96', '::ffff:0:0', 'unspecified'],
    ['::ffff:0:0/96', '::ffff:ffff:ffff', 'reserved'],
    ['::ffff:0:0/96', '::1:0:0:0', 'reserved'],
    ['64:ff9b::/96', '64:ff9b::', 'unspecified'],
    ['64:ff9b::/96', '64:ff9b::ffff:ffff', 'reserved'],
    ['64:ff9b::/96', '64:ff9b::1:0:0', 'reserved'],
    ['64:ff9b:1::/48', '64:ff9b:1::', 'reserved'],
    ['64:ff9b:1::/48', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['64:ff9b:1::/48', '64:ff9b:2::', 'reserved'],
    ['100::/64', '100::', 'reserved'],
    ['100::/64', '100::ffff:ffff:ffff:ffff', 'reserved'],
    ['100::/64', '100:0:0:1::', 'reserved'],
    ['2000::/3', '2000::', 'public'],
    ['2000::/3', '3fef:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'public'],
    ['2000::/3', '4000::', 'reserved'],
    ['2001::/32', '2001::', 'reserved'],
    ['2001::/32', '2001:0:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['2001::/32', '2001:1::', 'public'],
    ['2001:2::/48', '2001:2::', 'reserved'],
    ['2001:2::/48', '2001:2:0:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['2001:2::/48', '2001:2:1::', 'public'],
    ['2001:10::/28', '2001:10::', 'reserved'],
    ['2001:10::/28', '2001:1f:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['2001:10::/28', '2001:20::', 'public'],
    ['2001:db8::/32', '2001:db8::', 'reserved'],
    ['2001:db8::/32', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['2001:db8::/32', '2001:db9::', 'public'],
    ['2002::/16', '2002::', 'unspecified'],
    ['2002::/16', '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['2002::/16', '2003::', 'public'],
    ['3ff0::/12', '3ff0::', 'reserved'],
    ['3ff0::/12', '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['3ff0::/12', '3fef:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'public'],
    ['fc00::/7', 'fc00::', 'private'],
    ['fc00::/7', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'private'],
    ['fc00::/7', 'fe00::', 'reserved'],
    ['fe80::/10', 'fe80::', 'link-local'],
    ['fe80::/10', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'link-local'],
    ['fe80::/10', 'fec0::', 'reserved'],
    ['ff00::/8', 'ff00::', 'multicast'],
    ['ff00::/8', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'multicast'],
    ['ff00::/8', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  ] as const)('holds the edges of %s: %s is %s', (_range, address, expected) => {
    expect(classifyAddress(address)).toBe(expected)
  })

  it('keeps neighbouring ranges public rather than over-blocking', () => {
    expect(classifyAddress('172.15.255.255')).toBe('public')
    expect(classifyAddress('172.32.0.1')).toBe('public')
    expect(classifyAddress('100.63.255.255')).toBe('public')
    expect(classifyAddress('100.128.0.1')).toBe('public')
    expect(classifyAddress('9.255.255.255')).toBe('public')
    expect(classifyAddress('11.0.0.1')).toBe('public')
    expect(classifyAddress('2001:4860:4860::8888')).toBe('public')
    expect(classifyAddress('192.0.0.9')).toBe('public')
    expect(classifyAddress('192.0.0.10')).toBe('public')
    expect(classifyAddress('2001:20::1')).toBe('public')
  })

  it('sees through an IPv4-mapped IPv6 address to the address it carries', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback')
    expect(classifyAddress('::ffff:7f00:1')).toBe('loopback')
    expect(classifyAddress('::ffff:10.0.0.1')).toBe('private')
    expect(classifyAddress('::ffff:93.184.216.34')).toBe('public')
  })

  it('sees through 6to4 and NAT64 wrappers to the address they carry', () => {
    expect(classifyAddress('2002:7f00:0001::')).toBe('loopback')
    expect(classifyAddress('2002:c0a8:0101::')).toBe('private')
    expect(classifyAddress('64:ff9b::7f00:1')).toBe('loopback')
    expect(classifyAddress('64:ff9b::a00:1')).toBe('private')
  })

  it('treats the deprecated IPv4-compatible form as unusable', () => {
    expect(classifyAddress('::127.0.0.1')).toBe('reserved')
    expect(classifyAddress('::93.184.216.34')).toBe('reserved')
  })

  it('recognises only the 198.18.0.0/15 benchmarking range', () => {
    expect(isBenchmarkIpv4Literal('198.18.0.0')).toBe(true)
    expect(isBenchmarkIpv4Literal('198.18.0.1')).toBe(true)
    expect(isBenchmarkIpv4Literal('198.19.255.255')).toBe(true)
    expect(isBenchmarkIpv4Literal('198.17.255.255')).toBe(false)
    expect(isBenchmarkIpv4Literal('198.20.0.0')).toBe(false)
    expect(isBenchmarkIpv4Literal('10.0.0.1')).toBe(false)
    expect(isBenchmarkIpv4Literal('::ffff:198.18.0.1')).toBe(false)
  })

  it('rejects anything that is not an address at all', () => {
    expect(classifyAddress('localhost')).toBe('invalid')
    expect(classifyAddress('')).toBe('invalid')
    expect(classifyAddress('127.0.0.1:80')).toBe('invalid')
    expect(classifyAddress('[::1]')).toBe('invalid')
    expect(classifyAddress('0x7f000001')).toBe('invalid')
    expect(classifyAddress('127.1')).toBe('invalid')
  })
})
