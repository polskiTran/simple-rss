import { createHmac, timingSafeEqual } from 'node:crypto'
import { READER_IMAGE_PATH } from '../../shared/api.js'
import type { Clock } from '../clock.js'

export const READER_IMAGE_URL_LIFETIME_SECONDS = 2 * 86_400

/** The least key length that signs image URLs; the installation mints exactly this many bytes. */
export const IMAGE_URL_KEY_BYTES = 32

/** Mints the signed same-origin proxy path for one approved image target. */
export type SignImageUrl = (url: string) => string

export type VerifiedImageUrl =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'unsigned' | 'expired' | 'tampered' }

export interface ImageUrlSignature {
  readonly sign: SignImageUrl
  verify(query: URLSearchParams): VerifiedImageUrl
}

export function signReaderImageUrl(options: {
  readonly key: Uint8Array
  readonly nowMilliseconds: number
  readonly url: string
}): string {
  const expiry = String(Math.floor(options.nowMilliseconds / 1_000) + READER_IMAGE_URL_LIFETIME_SECONDS)
  const sig = imageUrlMac(options.key, expiry, options.url).toString('base64url')
  return `${READER_IMAGE_PATH}?url=${encodeURIComponent(options.url)}&exp=${expiry}&sig=${sig}`
}

export function createImageUrlSignature(options: {
  readonly key: Uint8Array
  readonly clock: Clock
}): ImageUrlSignature {
  if (options.key.byteLength < IMAGE_URL_KEY_BYTES) {
    throw new Error(`the image URL key must be at least ${IMAGE_URL_KEY_BYTES} bytes`)
  }
  const { key, clock } = options

  return {
    sign(url) {
      return signReaderImageUrl({ key, nowMilliseconds: clock.now().getTime(), url })
    },

    verify(query) {
      const url = query.get('url')
      const expiry = query.get('exp')
      const sig = query.get('sig')
      if (url === null || expiry === null || sig === null) {
        return { ok: false, reason: 'unsigned' }
      }

      const presented = Buffer.from(sig, 'base64url')
      const expected = imageUrlMac(key, expiry, url)
      if (presented.byteLength !== expected.byteLength || !timingSafeEqual(presented, expected)) {
        return { ok: false, reason: 'tampered' }
      }

      if (Number(expiry) * 1000 < clock.now().getTime()) {
        return { ok: false, reason: 'expired' }
      }

      return { ok: true, url }
    },
  }
}

function imageUrlMac(key: Uint8Array, expiry: string, url: string): Buffer {
  return createHmac('sha256', key).update(`${expiry}\n${url}`).digest()
}
