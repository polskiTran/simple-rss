import { describe, expect, it } from 'vitest'
import { IMAGE_CACHE_SECONDS, READER_IMAGE_PATH } from '../../src/shared/api.js'
import type { ResolveAddresses } from '../../src/server/upstream/destination.js'
import { claimedDevice, Device } from '../support/device.js'
import { startTestService, type TestService } from '../support/service-harness.js'
import { chunkedBody, UpstreamFixtures } from '../support/upstream-fixtures.js'

const FEED_URL = 'https://journal.example/feed'
const IMAGE_URL = 'https://journal.example/hero.png'
const ARTICLE_URL = 'https://journal.example/hero-story'

/** Valid magic bytes followed by padding, so sniffing has something real. */
function pngBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

const rss = (...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>Field Notes</title>${items.join('')}</channel></rss>`

const item = (guid: string, title: string, imageUrl?: string) => `
  <item>
    <guid>${guid}</guid>
    <title>${title}</title>
    <link>${ARTICLE_URL}</link>
    <pubDate>${new Date('2026-08-08T07:15:00.000Z').toUTCString()}</pubDate>
    <description>A clear morning over the valley.</description>
    ${imageUrl ? `<enclosure url="${imageUrl}" type="image/png"/>` : ''}
  </item>`

interface ImageSetup {
  readonly user: Device
  /** The Feed Item whose enclosure is the stubbed hero image. */
  readonly withImage: number
  /** A Feed Item that never carried an image. */
  readonly plain: number
}

async function imageSetup(service: TestService, imageUrl: string = IMAGE_URL): Promise<ImageSetup> {
  service.upstream.stub(FEED_URL, {
    headers: { 'content-type': 'application/rss+xml' },
    body: rss(item('hero', 'With a hero image', imageUrl), item('plain', 'Words alone')),
  })

  const user = await claimedDevice(service)
  expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
  await service.wakeScheduler()

  const digest = (await (await user.get('/api/digest')).json()) as {
    groups: { items: { feedItemId: number; title: string }[] }[]
  }
  const items = digest.groups.flatMap((group) => group.items)
  const idOf = (title: string): number => {
    const found = items.find((entry) => entry.title === title)
    if (!found) throw new Error(`"${title}" is not in the Digest`)
    return found.feedItemId
  }

  return { user, withImage: idOf('With a hero image'), plain: idOf('Words alone') }
}

describe('who may ask for an image', () => {
  it('answers 401 without a session on both routes', async () => {
    const service = await startTestService()
    await imageSetup(service)

    expect((await service.fetch('/api/items/1/image')).status).toBe(401)
    expect((await service.fetch(`${READER_IMAGE_PATH}?url=x&exp=1&sig=y`)).status).toBe(401)
  })
})

describe('the Feed Item image route', () => {
  it('streams the stored image with private week-long caching and nosniff', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)

    const response = await user.get(`/api/items/${withImage}/image`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe(`private, max-age=${IMAGE_CACHE_SECONDS}`)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes())

    // The proxy is what lets the image policy stay this narrow: same-origin
    // proxied images need no publisher origins in the CSP.
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data:")
  })

  it('forwards no cookies or credentials to the publisher', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)
    expect((await user.get(`/api/items/${withImage}/image`)).status).toBe(200)

    const [request] = service.upstream.requestsTo(IMAGE_URL)
    if (!request) throw new Error('the image was never requested upstream')
    expect(request.headers['cookie']).toBeUndefined()
    expect(request.headers['authorization']).toBeUndefined()
    // The Accept header is the image profile's, so the route can only ever
    // travel through the boundary's image operation.
    expect(request.headers['accept']).toBe('image/jpeg, image/png, image/webp, image/gif, image/avif')
  })

  it('answers an uncached 404 for items without an image, unknown items, and bad identities', async () => {
    const service = await startTestService()
    const { user, plain } = await imageSetup(service)

    const noImage = await user.get(`/api/items/${plain}/image`)
    expect(noImage.status).toBe(404)
    expect(noImage.headers.get('cache-control')).toBe('no-store')

    expect((await user.get('/api/items/999/image')).status).toBe(404)
    expect((await user.get('/api/items/not-an-id/image')).status).toBe(404)
  })

  it('points the Digest at the proxy and never at the publisher', async () => {
    const service = await startTestService()
    const { user, withImage, plain } = await imageSetup(service)

    const digest = await (await user.get('/api/digest')).text()
    expect(digest).toContain(`/api/items/${withImage}/image`)
    expect(digest).not.toContain(IMAGE_URL)

    const parsed = JSON.parse(digest) as { groups: { items: { feedItemId: number; imageUrl: string | null }[] }[] }
    const items = parsed.groups.flatMap((group) => group.items)
    expect(items.find((entry) => entry.feedItemId === plain)?.imageUrl).toBeNull()
  })
})

const ARTICLE_HTML = `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><title>Hero story</title></head>
    <body>
      <main><article>
        <h1>Hero story</h1>
        <img src="/hero.png" alt="First light over the valley">
        ${Array.from({ length: 20 }, (_, index) => `<p>Paragraph ${index} carries the morning along with a steady sentence about the valley, written long enough to count as honest reading time.</p>`).join('\n')}
      </article></main>
    </body>
  </html>`

/** Reads the one signed image path out of an extracted article. */
async function signedImagePath(user: Device, feedItemId: number): Promise<string> {
  const response = await user.get(`/api/items/${feedItemId}/reader`)
  expect(response.status).toBe(200)
  const { markdown } = (await response.json()) as { markdown: string }
  const match = /!\[[^\]]*\]\(([^)]+)\)/.exec(markdown)
  if (!match?.[1]) throw new Error(`no image reference in the markdown:\n${markdown}`)
  return match[1].replaceAll('%28', '(').replaceAll('%29', ')')
}

describe('the signed Reader image route', () => {
  it('rewrites extracted images to signed same-origin paths that serve the image', async () => {
    const service = await startTestService()
    service.upstream.stub(ARTICLE_URL, { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML })
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)

    const path = await signedImagePath(user, withImage)
    expect(path.startsWith(`${READER_IMAGE_PATH}?`)).toBe(true)

    const image = await user.get(path)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('cache-control')).toBe(`private, max-age=${IMAGE_CACHE_SECONDS}`)
  })

  it('refuses an unsigned or arbitrary target', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user } = await imageSetup(service)

    const unsigned = await user.get(`${READER_IMAGE_PATH}?url=${encodeURIComponent(IMAGE_URL)}`)
    expect(unsigned.status).toBe(404)
    expect(unsigned.headers.get('cache-control')).toBe('no-store')
    expect(service.upstream.requestsTo(IMAGE_URL)).toHaveLength(0)
  })

  it('refuses a signed path whose target was swapped', async () => {
    const service = await startTestService()
    service.upstream.stub(ARTICLE_URL, { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML })
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)

    const path = await signedImagePath(user, withImage)
    const tampered = path.replace(
      encodeURIComponent(IMAGE_URL),
      encodeURIComponent('https://somewhere-else.example/loot.png'),
    )
    expect(tampered).not.toBe(path)

    expect((await user.get(tampered)).status).toBe(404)
    expect(service.upstream.requestsTo('https://somewhere-else.example/loot.png')).toHaveLength(0)
  })

  it('refuses a signed path after it expires', async () => {
    const service = await startTestService()
    service.upstream.stub(ARTICLE_URL, { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML })
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)

    const path = await signedImagePath(user, withImage)
    expect((await user.get(path)).status).toBe(200)

    service.clock.advance((2 * 86_400 + 60) * 1000)
    expect((await user.get(path)).status).toBe(404)
  })

  it('refuses old signed paths after a restart, because the key is per process', async () => {
    const service = await startTestService()
    service.upstream.stub(ARTICLE_URL, { headers: { 'content-type': 'text/html' }, body: ARTICLE_HTML })
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/png' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)
    const path = await signedImagePath(user, withImage)

    // The session survives the restart on the volume; the signing key does not.
    await service.restart()
    expect((await user.get(path)).status).toBe(404)
  })
})

/** A further device signing in to an installation someone already claimed. */
async function signedInDevice(service: TestService, address: string): Promise<Device> {
  const device = new Device(service, { address })
  const response = await device.signIn()
  if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
    throw new Error(`could not sign in: ${response.status}`)
  }
  return device
}

describe('destination hardening', () => {
  it('refuses an image pointing back at this installation', async () => {
    const service = await startTestService()
    const { user, withImage } = await imageSetup(service, 'https://reader.test/api/auth/status')

    const response = await user.get(`/api/items/${withImage}/image`)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses an image on a private address', async () => {
    const service = await startTestService()
    const { user, withImage } = await imageSetup(service, 'https://192.168.1.20/hero.png')

    expect((await user.get(`/api/items/${withImage}/image`)).status).toBe(404)
    expect(service.upstream.requests).not.toContainEqual(
      expect.objectContaining({ url: 'https://192.168.1.20/hero.png' }),
    )
  })

  it('refuses an image that redirects to a private address', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, { status: 302, headers: { location: 'https://10.0.0.5/internal.png' } })
    const { user, withImage } = await imageSetup(service)

    expect((await user.get(`/api/items/${withImage}/image`)).status).toBe(404)
    expect(service.upstream.requests).not.toContainEqual(
      expect.objectContaining({ url: 'https://10.0.0.5/internal.png' }),
    )
  })

  it('refuses an image whose host now resolves to a private address', async () => {
    // The publisher's DNS changed after the Feed was ingested — the ordinary
    // shape of a rebinding attempt — so the fetch-time answer is what counts.
    class MovedDns extends UpstreamFixtures {
      override get resolve(): ResolveAddresses {
        const base = super.resolve
        return async (hostname, signal) =>
          hostname === 'moved.example' ? ['10.0.0.9'] : base(hostname, signal)
      }
    }

    const service = await startTestService({ upstream: new MovedDns() })
    const { user, withImage } = await imageSetup(service, 'https://moved.example/hero.png')

    expect((await user.get(`/api/items/${withImage}/image`)).status).toBe(404)
    expect(service.upstream.requests).not.toContainEqual(
      expect.objectContaining({ url: 'https://moved.example/hero.png' }),
    )
  })
})

describe('format validation', () => {
  it.each([
    ['SVG, which is a scriptable document', 'image/svg+xml', '<svg onload="alert(1)"/>'],
    ['HTML declared as HTML', 'text/html', '<html>not an image</html>'],
  ])('refuses %s', async (_name, contentType, body) => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': contentType }, body })
    const { user, withImage } = await imageSetup(service)

    const response = await user.get(`/api/items/${withImage}/image`)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses bytes that are not the image the publisher declared', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, {
      headers: { 'content-type': 'image/png' },
      body: '<html>spoofed as png</html>',
    })
    const { user, withImage } = await imageSetup(service)

    const response = await user.get(`/api/items/${withImage}/image`)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a mismatch even between two allowed formats', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, { headers: { 'content-type': 'image/jpeg' }, body: pngBytes() })
    const { user, withImage } = await imageSetup(service)

    expect((await user.get(`/api/items/${withImage}/image`)).status).toBe(404)
  })

  it('accepts each allowed format when the bytes agree', async () => {
    const formats: [string, Uint8Array][] = [
      ['image/jpeg', bytesOf([0xff, 0xd8, 0xff, 0xe0], 24)],
      ['image/gif', bytesOf([...'GIF89a'].map((c) => c.charCodeAt(0)), 24)],
      ['image/webp', webpBytes()],
      ['image/avif', avifBytes()],
    ]
    const service = await startTestService()
    const { user, withImage } = await imageSetup(service)

    for (const [contentType, bytes] of formats) {
      service.upstream.stub(IMAGE_URL, { headers: { 'content-type': contentType }, body: bytes })
      const response = await user.get(`/api/items/${withImage}/image`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType)
    }
  })
})

function bytesOf(head: number[], size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(head)
  return bytes
}

function webpBytes(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  bytes.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8)
  return bytes
}

function avifBytes(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([...'ftypavif'].map((c) => c.charCodeAt(0)), 4)
  return bytes
}

describe('resource limits', () => {
  it('refuses an image that declares itself above the five MiB ceiling', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, {
      headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) },
      body: pngBytes(),
    })
    const { user, withImage } = await imageSetup(service)

    expect((await user.get(`/api/items/${withImage}/image`)).status).toBe(404)
  })

  it('streams by count, so a small false Content-Length does not truncate', async () => {
    const service = await startTestService()
    service.upstream.stub(IMAGE_URL, {
      headers: { 'content-type': 'image/png', 'content-length': '10' },
      body: pngBytes(64),
    })
    const { user, withImage } = await imageSetup(service)

    const response = await user.get(`/api/items/${withImage}/image`)
    expect(response.status).toBe(200)
    expect((await response.arrayBuffer()).byteLength).toBe(64)
  })

  it('tears the stream down when the body grows past the ceiling', async () => {
    const service = await startTestService()
    const megabyte = 1024 * 1024
    service.upstream.stub(IMAGE_URL, {
      headers: { 'content-type': 'image/png' },
      body: chunkedBody([pngBytes(megabyte), ...Array.from({ length: 5 }, () => new Uint8Array(megabyte))]),
    })
    const { user, withImage } = await imageSetup(service)

    const response = await user.get(`/api/items/${withImage}/image`)
    // The headers were honest when they left; the lie is only discovered
    // mid-body, where the connection is torn down rather than completed.
    await expect(async () => {
      if ((await response.arrayBuffer()).byteLength > 5 * megabyte) throw new Error('served past the ceiling')
    }).rejects.toThrow()
  })
})

describe('image rate limiting', () => {
  it('refuses a client that asks faster than the window allows, without caching the refusal', async () => {
    const service = await startTestService()
    await imageSetup(service)
    const greedy = await signedInDevice(service, '203.0.113.7')

    let refused: Response | undefined
    for (let index = 0; index < 241 && !refused; index += 1) {
      const response = await greedy.get('/api/items/999/image')
      if (response.status === 429) refused = response
    }

    if (!refused) throw new Error('the window never closed')
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(refused.headers.get('cache-control')).toBe('no-store')

    // The window is per client address, so the User's other device is not
    // slowed by the greedy one.
    const other = await signedInDevice(service, '203.0.113.8')
    expect((await other.get('/api/items/999/image')).status).toBe(404)
  })
})
