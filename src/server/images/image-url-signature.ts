import { createHmac, timingSafeEqual } from 'node:crypto'
import { READER_IMAGE_PATH } from '../../shared/api.js'
import type { Clock } from '../clock.js'

// Twice the article's own browser-cache life, so every image reference inside
// a cached article outlives the article that carries it.
export const READER_IMAGE_URL_LIFETIME_SECONDS = 2 * 86_400

/** Mints the signed same-origin proxy path for one approved image target. */
export type SignImageUrl = (url: string) => string

export type VerifiedImageUrl =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'unsigned' | 'expired' | 'tampered' }

export interface ImageUrlSignature {
  readonly sign: SignImageUrl
  verify(query: URLSearchParams): VerifiedImageUrl
}

/**
 * Binds target and expiry to this installation's key, so the image proxy only fetches
 * what extraction approved. The key lives for one process: a restart turns images in
 * an already-cached article into their fallback until re-extraction.
 */
export function createImageUrlSignature(options: {
  readonly key: Uint8Array
  readonly clock: Clock
}): ImageUrlSignature {
  if (options.key.byteLength < 32) {
    throw new Error('the image URL key must be at least 32 bytes')
  }
  const { key, clock } = options

  const mac = (expiry: string, url: string): Buffer =>
    createHmac('sha256', key).update(`${expiry}\n${url}`).digest()

  return {
    sign(url) {
      const expiry = String(Math.floor(clock.now().getTime() / 1000) + READER_IMAGE_URL_LIFETIME_SECONDS)
      const sig = mac(expiry, url).toString('base64url')
      return `${READER_IMAGE_PATH}?url=${encodeURIComponent(url)}&exp=${expiry}&sig=${sig}`
    },

    verify(query) {
      const url = query.get('url')
      const expiry = query.get('exp')
      const sig = query.get('sig')
      if (url === null || expiry === null || sig === null) {
        return { ok: false, reason: 'unsigned' }
      }

      const presented = Buffer.from(sig, 'base64url')
      const expected = mac(expiry, url)
      if (presented.byteLength !== expected.byteLength || !timingSafeEqual(presented, expected)) {
        return { ok: false, reason: 'tampered' }
      }

      // Anything unsigned already failed above, so a forged expiry never reaches this comparison.
      if (Number(expiry) * 1000 < clock.now().getTime()) {
        return { ok: false, reason: 'expired' }
      }

      return { ok: true, url }
    },
  }
}
