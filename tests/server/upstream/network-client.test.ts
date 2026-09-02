import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, type AddressInfo, type LookupFunction, type Socket } from 'node:net'
import { promisify } from 'node:util'
import { brotliCompress, createGzip, gzip } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../../../src/server/logger.js'
import type { HttpClient, HttpTimings } from '../../../src/server/upstream/http-client.js'
import { createNetworkHttpClient, guardedLookup } from '../../../src/server/upstream/network-client.js'
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

function clientReachingTheTestServer(): HttpClient {
  return createNetworkHttpClient({ isAllowedAddress: () => true })
}

// Answers on a later tick the way real DNS does; a synchronous callback would
// emit the socket's `lookup` event before any request-level listener attaches.
const testServerLookup: LookupFunction = (_hostname, options, callback) => {
  const answer = { address: '127.0.0.1', family: 4 as const }
  setImmediate(() => {
    if (options.all) callback(null, [answer] as never, 0)
    else callback(null, answer.address, answer.family)
  })
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

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

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
    await clientReachingTheTestServer()(
      new Request(url, { headers: { 'user-agent': 'simple-rss/test', 'if-none-match': '"v1"' } }),
    )

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

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

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
    const retrieval = createRetrieval({
      httpClient: createNetworkHttpClient({
        isAllowedAddress: () => true,
        lookup: testServerLookup,
      }),
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

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

    await expect(response.text()).resolves.toBe('<rss>brotli</rss>')
  })

  it('decodes a valid stack of content encodings in reverse order', async () => {
    const decoded = Buffer.from('<rss>stacked</rss>')
    const compressed = await compressBrotli(await compressGzip(decoded))
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'gzip, br' })
      response.end(compressed)
    })

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

    await expect(response.text()).resolves.toBe(decoded.toString())
    expect(response.headers.get('content-encoding')).toBeNull()
  })

  it('rejects a declared content encoding it cannot decode', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'zstd' })
      response.end('encoded bytes')
    })

    await expect(clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))).rejects.toMatchObject({
      code: 'unsupported_content_encoding',
    })
  })

  it('asks for encodings it can actually decode', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

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

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed`))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/feeds/main.xml')
    expect(running.requests).toHaveLength(1)
  })

  it('gives a bodiless status no body at all', async () => {
    running = await origin((_request, response) => {
      response.writeHead(304, { etag: '"v1"' })
      response.end()
    })

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

    expect(response.status).toBe(304)
    expect(response.body).toBeNull()
  })

  it('drops a cookie the origin tries to set, which nothing here would use', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml', 'set-cookie': 'track=1' })
      response.end('<rss></rss>')
    })

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))

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
    const response = await clientReachingTheTestServer()(
      new Request(`${running.url}/feed.xml`, { signal: controller.signal }),
    )
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

    const response = await clientReachingTheTestServer()(new Request(`${running.url}/feed.xml`))
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
    const client = createNetworkHttpClient({ isAllowedAddress: () => true, lookup: testServerLookup })
    const observed: HttpTimings[] = []

    const first = await client(new Request(url), (timings) => observed.push(timings))
    await first.text()
    const second = await client(new Request(url), (timings) => observed.push(timings))
    await second.text()

    const fresh = observed[0]
    expect(fresh?.connectionReused).toBe(false)
    expect(fresh?.socketDnsMs).toBeGreaterThanOrEqual(0)
    expect(fresh?.connectMs).toBeGreaterThanOrEqual(0)
    expect(fresh?.ttfbMs).toBeGreaterThanOrEqual(0)
    expect(fresh?.tlsMs).toBeUndefined()

    const reused = observed[1]
    expect(reused?.connectionReused).toBe(true)
    expect(reused?.socketDnsMs).toBeUndefined()
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
    const client = createNetworkHttpClient({ isAllowedAddress: () => true, lookup: testServerLookup })
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
        const response = await client(new Request(url), (timings) => observed.push(timings))
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
    const client = createNetworkHttpClient({ isAllowedAddress: () => true, lookup: testServerLookup })

    const occupants = Array.from({ length: 8 }, (_, index) =>
      client(new Request(`http://occupant-${index}.example:${port}/feed`)).catch(() => {}),
    )
    try {
      await expect.poll(() => held.length).toBe(8)

      const controller = new AbortController()
      const reading = client(new Request(`http://article.example:${port}/post`, { signal: controller.signal }))
      controller.abort(new Error('the Reader gave up'))

      await expect(reading).rejects.toThrow('the Reader gave up')
    } finally {
      for (const socket of held) socket.destroy()
      await new Promise<void>((resolve) => silent.close(() => resolve()))
      await Promise.all(occupants)
    }
  })

  it('refuses a private address by default, before anything is connected to', async () => {
    running = await origin((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('<rss></rss>')
    })

    await expect(createNetworkHttpClient()(new Request(`${running.url}/feed.xml`))).rejects.toThrow(/refus|address/i)
    expect(running.requests).toHaveLength(0)
  })
})

describe('guardedLookup', () => {
  it('refuses a name that answers with an address no retrieval may reach', async () => {
    const lookup = guardedLookup()

    await expect(resolveWith(lookup, 'localhost')).rejects.toMatchObject({ code: 'blocked_destination' })
  })

  it('passes a name whose addresses are all allowed through to the connection', async () => {
    const lookup = guardedLookup(() => true)

    await expect(resolveWith(lookup, 'localhost')).resolves.not.toHaveLength(0)
  })
})

function resolveWith(
  lookup: ReturnType<typeof guardedLookup>,
  hostname: string,
): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) reject(error)
      else resolve(addresses as { address: string; family: number }[])
    })
  })
}
