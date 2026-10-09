import type { LookupAddress } from 'node:dns'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createTcpServer, type AddressInfo, type LookupFunction, type Socket } from 'node:net'
import { getCACertificates, setDefaultCACertificates, type TLSSocket } from 'node:tls'
import { promisify } from 'node:util'
import { brotliCompress, createGzip, gzip } from 'node:zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../../../src/server/logger.js'
import type { HttpConnection, HttpTimings } from '../../../src/server/upstream/http-client.js'
import { createNetworkHttpClient, pinnedLookup } from '../../../src/server/upstream/network-client.js'
import { createRetrieval } from '../../../src/server/upstream/retrieval.js'

const compressGzip = promisify(gzip)
const compressBrotli = promisify(brotliCompress)

type Handler = (request: IncomingMessage, response: ServerResponse) => void

interface Origin {
  readonly url: string
  readonly requests: readonly IncomingMessage[]
  close(): Promise<void>
}

async function origin(handler: Handler): Promise<Origin> {
  const requests: IncomingMessage[] = []
  const server: Server = createServer((request, response) => {
    requests.push(request)
    handler(request, response)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Every test origin listens here; the adapter is handed it as the approved address. */
const TEST_SERVER: HttpConnection = { addresses: ['127.0.0.1'] }

function send(request: Request): Promise<Response> {
  return createNetworkHttpClient()(request, TEST_SERVER)
}

describe('createNetworkHttpClient', () => {
  let running: Origin | undefined

  afterEach(async () => {
    await running?.close()
    running = undefined
  })

  it('returns the status, headers, and body the origin sent', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    const response = await send(new Request(`${running.url}/feed.xml`))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/xml')
    await expect(response.text()).resolves.toBe('<rss></rss>')
  })

  it('sends the headers it was given and identifies the host it asked', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    const url = new URL(`${running.url}/feed.xml`)
    await send(new Request(url, { headers: { 'user-agent': 'simple-rss/test', 'if-none-match': '"v1"' } }))

    const [received] = running.requests
    expect(received?.headers['user-agent']).toBe('simple-rss/test')
    expect(received?.headers['if-none-match']).toBe('"v1"')
    expect(received?.headers.host).toBe(url.host)
    expect(received?.headers).not.toHaveProperty('cookie')
  })

  it('decodes a gzip body and stops describing it as encoded', async () => {
    const compressed = await compressGzip(Buffer.from('<rss>compressed</rss>'))
    running = await origin((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/xml',
        'content-encoding': 'gzip',
        'content-length': String(compressed.byteLength),
      })
      response.end(compressed)
    })

    const response = await send(new Request(`${running.url}/feed.xml`))

    await expect(response.text()).resolves.toBe('<rss>compressed</rss>')
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
  })

  it('aborts when a small compressed body expands past the decoded ceiling', async () => {
    const decoded = 'x'.repeat(1024 * 1024)
    const compressed = await compressGzip(Buffer.from(decoded))
    expect(compressed.byteLength).toBeLessThan(decoded.length / 100)
    running = await origin((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/xml',
        'content-encoding': 'gzip',
        'content-length': String(compressed.byteLength),
      })
      response.end(compressed)
    })
    const port = new URL(running.url).port
    const network = createNetworkHttpClient()
    const retrieval = createRetrieval({
      // Validation approves the public answer; the test then re-pins the
      // socket to its own loopback origin, which no validation would approve.
      httpClient: (request, connection) => network(request, { ...connection, ...TEST_SERVER }),
      logger: createLogger({ level: 'error', sink: () => {} }),
      resolve: async () => ['93.184.216.34'],
      self: new URL('https://reader.test'),
    })

    await expect(
      retrieval.retrieveBytes({
        url: `http://publisher.example:${port}/feed.xml`,
        operation: 'feed',
        limits: { maxBytes: 1_000 },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'too_large' })
  })

  it('decodes a brotli body', async () => {
    const compressed = await compressBrotli(Buffer.from('<rss>brotli</rss>'))
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'br' })
      response.end(compressed)
    })

    const response = await send(new Request(`${running.url}/feed.xml`))

    await expect(response.text()).resolves.toBe('<rss>brotli</rss>')
  })

  it('decodes a valid stack of content encodings in reverse order', async () => {
    const decoded = Buffer.from('<rss>stacked</rss>')
    const compressed = await compressBrotli(await compressGzip(decoded))
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'gzip, br' })
      response.end(compressed)
    })

    const response = await send(new Request(`${running.url}/feed.xml`))

    await expect(response.text()).resolves.toBe(decoded.toString())
    expect(response.headers.get('content-encoding')).toBeNull()
  })

  it('rejects a declared content encoding it cannot decode', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'zstd' })
      response.end('encoded bytes')
    })

    await expect(send(new Request(`${running.url}/feed.xml`))).rejects.toMatchObject({
      code: 'unsupported_content_encoding',
    })
  })

  it('asks for encodings it can actually decode', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    await send(new Request(`${running.url}/feed.xml`))

    expect(running.requests[0]?.headers['accept-encoding']).toBe('gzip, deflate, br')
  })

  it('hands a redirect back rather than following it', async () => {
    running = await origin((request, response) => {
      if (request.url === '/feed') {
        response.writeHead(302, { location: '/feeds/main.xml' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    const response = await send(new Request(`${running.url}/feed`))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/feeds/main.xml')
    expect(running.requests).toHaveLength(1)
  })

  it('gives a bodiless status no body at all', async () => {
    running = await origin((_request, response) => {
      response.writeHead(304, { etag: '"v1"' })
      response.end()
    })

    const response = await send(new Request(`${running.url}/feed.xml`))

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
  })

  it('drops a cookie the origin tries to set, which nothing here would use', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'set-cookie': 'track=1' })
      response.end('<rss></rss>')
    })

    const response = await send(new Request(`${running.url}/feed.xml`))

    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('tears the connection down when the caller gives up mid-body', async () => {
    let closed: (() => void) | undefined
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve
    })
    running = await origin((request, response) => {
      request.on('close', () => closed?.())
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.write('<rss>')
    })

    const controller = new AbortController()
    const response = await send(new Request(`${running.url}/feed.xml`, { signal: controller.signal }))
    const reading = new Response(response.body).text()
    controller.abort()

    await expect(reading).rejects.toThrow()
    await expect(connectionClosed).resolves.toBeUndefined()
  })

  it('closes the connection under a compressed body the caller stops reading', async () => {
    let closed: (() => void) | undefined
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve
    })
    running = await origin((request, response) => {
      request.on('close', () => closed?.())
      response.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'gzip' })
      const compressing = createGzip()
      compressing.pipe(response)
      compressing.write('<rss>')
      compressing.flush()
    })

    const response = await send(new Request(`${running.url}/feed.xml`))
    await response.body?.cancel()

    await expect(connectionClosed).resolves.toBeUndefined()
  })

  it('times connection phases on a fresh connection and reports them skipped on reuse', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })
    const port = new URL(running.url).port
    const url = `http://publisher.example:${port}/feed.xml`
    const client = createNetworkHttpClient()
    const observed: HttpTimings[] = []
    const connection: HttpConnection = { ...TEST_SERVER, onTimings: (timings) => observed.push(timings) }

    const first = await client(new Request(url), connection)
    await first.text()
    const second = await client(new Request(url), connection)
    await second.text()

    const fresh = observed[0]
    expect(fresh?.connectionReused).toBe(false)
    expect(fresh?.connectMs).toBeGreaterThanOrEqual(0)
    expect(fresh?.ttfbMs).toBeGreaterThanOrEqual(0)
    expect(fresh?.tlsMs).toBeUndefined()

    const reused = observed[1]
    expect(reused?.connectionReused).toBe(true)
    expect(reused?.connectMs).toBeUndefined()
    expect(reused?.ttfbMs).toBeGreaterThanOrEqual(0)
  })

  it('leaves nothing on a pooled socket, however many requests borrow it', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })
    const port = new URL(running.url).port
    const url = `http://publisher.example:${port}/feed.xml`
    const client = createNetworkHttpClient()
    const warnings: Error[] = []
    const onWarning = (warning: Error): void => {
      if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning)
    }
    process.on('warning', onWarning)

    try {
      const observed: HttpTimings[] = []
      // Node warns at the eleventh listener for one event on one emitter;
      // a leak of one listener per request crosses that on the twelfth request.
      for (let sent = 0; sent < 12; sent += 1) {
        const response = await client(new Request(url), {
          ...TEST_SERVER,
          onTimings: (timings) => observed.push(timings),
        })
        await response.text()
      }
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(observed.filter((timings) => timings.connectionReused)).toHaveLength(11)
      expect(warnings).toEqual([])
    } finally {
      process.off('warning', onWarning)
    }
  })

  it('settles an abort promptly while other requests hold every connected socket', async () => {
    const held: Socket[] = []
    const silent = createTcpServer((socket) => {
      held.push(socket)
      socket.on('error', () => {})
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()))
    const { port } = silent.address() as AddressInfo
    const client = createNetworkHttpClient()

    const occupants = Array.from({ length: 8 }, (_, index) =>
      client(new Request(`http://occupant-${index}.example:${port}/feed`), TEST_SERVER).catch(() => {}),
    )
    try {
      await expect.poll(() => held.length).toBe(8)

      const controller = new AbortController()
      const reading = client(
        new Request(`http://article.example:${port}/post`, { signal: controller.signal }),
        TEST_SERVER,
      )
      controller.abort(new Error('the Reader gave up'))

      await expect(reading).rejects.toThrow('the Reader gave up')
    } finally {
      for (const socket of held) socket.destroy()
      await new Promise<void>((resolve) => silent.close(() => resolve()))
      await Promise.all(occupants)
    }
  })

  it('connects a name to the address it was handed, without resolving the name', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })
    const port = new URL(running.url).port

    // `.invalid` never resolves: reaching the origin proves no DNS query ran.
    const response = await send(new Request(`http://publisher.invalid:${port}/feed.xml`))

    await expect(response.text()).resolves.toBe('<rss></rss>')
    expect(running.requests[0]?.headers.host).toBe(`publisher.invalid:${port}`)
  })

  it('refuses an address literal it was not handed, before anything is connected to', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    await expect(
      createNetworkHttpClient()(new Request(`${running.url}/feed.xml`), { addresses: ['93.184.216.34'] }),
    ).rejects.toMatchObject({ code: 'blocked_destination' })
    expect(running.requests).toHaveLength(0)
  })
})

describe('pinnedLookup', () => {
  const pinned = ['93.184.216.34', '2606:2800:220:1::248']

  it('answers any name with exactly the addresses it was handed', async () => {
    await expect(lookupWith(pinnedLookup(pinned), 'localhost', { all: true })).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::248', family: 6 },
    ])
  })

  it('narrows to the family the socket asks for', async () => {
    await expect(lookupWith(pinnedLookup(pinned), 'localhost', { family: 6 })).resolves.toEqual({
      address: '2606:2800:220:1::248',
      family: 6,
    })
  })

  it('fails rather than resolving when no handed address fits', async () => {
    await expect(lookupWith(pinnedLookup(['93.184.216.34']), 'localhost', { family: 6 })).rejects.toMatchObject({
      code: 'blocked_destination',
    })
  })
})

function lookupWith(
  lookup: LookupFunction,
  hostname: string,
  options: { readonly all?: boolean; readonly family?: number },
): Promise<LookupAddress | LookupAddress[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { ...options }, (error, address, family) => {
      if (error) reject(error)
      else resolve(typeof address === 'string' ? { address, family: family ?? 0 } : address)
    })
  })
}

describe('TLS to a pinned address', () => {
  const cert = readFileSync('tests/fixtures/tls/publisher.invalid.cert.pem', 'utf8')
  const key = readFileSync('tests/fixtures/tls/publisher.invalid.key.pem', 'utf8')
  const trusted = getCACertificates('default')
  const servernames: TLSSocket['servername'][] = []
  const server = createHttpsServer({ cert, key }, (request, response) => {
    // SAFETY: an `https` server's request socket is always a `TLSSocket`.
    servernames.push((request.socket as TLSSocket).servername)
    response.writeHead(200, { 'content-type': 'application/xml' })
    response.end('<rss></rss>')
  })
  let port = 0

  beforeAll(async () => {
    setDefaultCACertificates([...trusted, cert])
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    setDefaultCACertificates(trusted)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('names the URL host to the server and verifies the certificate against it', async () => {
    const response = await send(new Request(`https://publisher.invalid:${port}/feed.xml`))

    await expect(response.text()).resolves.toBe('<rss></rss>')
    expect(servernames).toEqual(['publisher.invalid'])
  })

  it('refuses a certificate that does not name the URL host, though the address is the same', async () => {
    await expect(send(new Request(`https://impostor.invalid:${port}/feed.xml`))).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
  })
})
