import { describe, expect, it } from 'vitest'
import { classifyAddress, isPublicAddress } from '../../../src/server/upstream/addresses.js'

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

  it('rejects anything that is not an address at all', () => {
    expect(classifyAddress('localhost')).toBe('invalid')
    expect(classifyAddress('')).toBe('invalid')
    expect(classifyAddress('127.0.0.1:80')).toBe('invalid')
    expect(classifyAddress('[::1]')).toBe('invalid')
    expect(classifyAddress('0x7f000001')).toBe('invalid')
    expect(classifyAddress('127.1')).toBe('invalid')
  })
})

describe('isPublicAddress', () => {
  it('is true only for an address a retrieval may connect to', () => {
    expect(isPublicAddress('93.184.216.34')).toBe(true)
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('not-an-address')).toBe(false)
  })
})
