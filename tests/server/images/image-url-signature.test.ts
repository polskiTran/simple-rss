import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { READER_IMAGE_PATH } from '../../../src/shared/api.js'
import {
  createImageUrlSignature,
  READER_IMAGE_URL_LIFETIME_SECONDS,
} from '../../../src/server/images/image-url-signature.js'
import { ManualClock } from '../../support/manual-clock.js'

const TARGET = 'https://press.example/photos/morning.jpg?width=1200'

function signature(clock = new ManualClock()) {
  return createImageUrlSignature({ key: randomBytes(32), clock })
}

function queryOf(signedPath: string): URLSearchParams {
  return new URL(signedPath, 'https://reader.test').searchParams
}

describe('signing a Reader image URL', () => {
  it('produces a same-origin path that verifies back to the target', () => {
    const signer = signature()
    const signed = signer.sign(TARGET)

    expect(signed.startsWith(`${READER_IMAGE_PATH}?`)).toBe(true)
    expect(signer.verify(queryOf(signed))).toEqual({ ok: true, url: TARGET })
  })

  it('binds the signature to the exact target', () => {
    const signer = signature()
    const query = queryOf(signer.sign(TARGET))
    query.set('url', 'https://press.example/photos/other.jpg')

    expect(signer.verify(query)).toEqual({ ok: false, reason: 'tampered' })
  })

  it('binds the signature to the exact expiry', () => {
    const signer = signature()
    const query = queryOf(signer.sign(TARGET))
    query.set('exp', String(Number(query.get('exp')) + 3600))

    expect(signer.verify(query)).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects a signature altered in place', () => {
    const signer = signature()
    const query = queryOf(signer.sign(TARGET))
    const sig = query.get('sig') ?? ''
    query.set('sig', (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1))

    expect(signer.verify(query)).toEqual({ ok: false, reason: 'tampered' })
  })

  it('rejects a signature minted under a different key', () => {
    const clock = new ManualClock()
    const minted = signature(clock).sign(TARGET)

    expect(signature(clock).verify(queryOf(minted))).toEqual({ ok: false, reason: 'tampered' })
  })

  it('treats missing parameters as unsigned', () => {
    const signer = signature()

    expect(signer.verify(new URLSearchParams())).toEqual({ ok: false, reason: 'unsigned' })
    expect(signer.verify(new URLSearchParams({ url: TARGET }))).toEqual({ ok: false, reason: 'unsigned' })

    const noSig = queryOf(signer.sign(TARGET))
    noSig.delete('sig')
    expect(signer.verify(noSig)).toEqual({ ok: false, reason: 'unsigned' })
  })

  it('expires after its lifetime, and only then', () => {
    const clock = new ManualClock()
    const signer = signature(clock)
    const query = queryOf(signer.sign(TARGET))

    clock.advance(READER_IMAGE_URL_LIFETIME_SECONDS * 1000 - 1000)
    expect(signer.verify(query)).toEqual({ ok: true, url: TARGET })

    clock.advance(2000)
    expect(signer.verify(query)).toEqual({ ok: false, reason: 'expired' })
  })

  it('treats a non-numeric expiry as tampering rather than crashing', () => {
    const signer = signature()
    const query = queryOf(signer.sign(TARGET))
    query.set('exp', 'soon')

    expect(signer.verify(query)).toEqual({ ok: false, reason: 'tampered' })
  })
})
