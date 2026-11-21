import type { LookupAddress } from 'node:dns'
import {
  Agent as HttpAgent,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable, type Duplex } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { elapsedMs } from '../monotonic.js'
import { unbracket } from './addresses.js'
import { HttpClientError, type HttpClient, type HttpTimings } from './http-client.js'

const ACCEPT_ENCODING = 'gzip, deflate, br'

const BODILESS_STATUSES = new Set([204, 205, 304])

const MAX_FREE_SOCKETS_PER_PROTOCOL = 4

export function createNetworkHttpClient(): HttpClient {
  const agentOptions = {
    keepAlive: true,
    maxFreeSockets: MAX_FREE_SOCKETS_PER_PROTOCOL,
  }
  const httpAgent = new HttpAgent(agentOptions)
  const httpsAgent = new HttpsAgent(agentOptions)

  return async (request, { addresses, onTimings }) => {
    const url = new URL(request.url)
    const secure = url.protocol === 'https:'
    if (!secure && url.protocol !== 'http:') {
      throw new Error(`refusing to retrieve over ${url.protocol}`)
    }

    const host = unbracket(url.hostname)
    if (isIP(host) !== 0 && !addresses.includes(host)) {
      throw new HttpClientError('blocked_destination', 'address literal was not approved for this connection')
    }

    const headers: OutgoingHttpHeaders = {}
    request.headers.forEach((value, name) => {
      headers[name] = value
    })
    headers['accept-encoding'] ??= ACCEPT_ENCODING

    const outbound = (secure ? httpsRequest : httpRequest)(url, {
      method: request.method,
      headers,
      lookup: pinnedLookup(addresses),
      agent: secure ? httpsAgent : httpAgent,
    })
    const connectionTimings = observeConnection(outbound)

    const { signal } = request
    if (signal.aborted) {
      outbound.destroy()
      throw reasonFor(signal)
    }

    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>()
    const abandon = (): void => {
      const reason = reasonFor(signal)
      outbound.destroy(reason)
      reject(reason)
    }
    signal.addEventListener('abort', abandon, { once: true })
    outbound.on('close', () => signal.removeEventListener('abort', abandon))
    outbound.on('response', (response) => {
      onTimings?.(connectionTimings())
      resolve(response)
    })
    outbound.on('error', reject)

    outbound.end()
    return toResponse(await promise)
  }
}

export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const pinned = addresses.flatMap((address): LookupAddress[] => {
    const family = isIP(address)
    return family === 0 ? [] : [{ address, family }]
  })

  return (_hostname, options, callback) => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family
    const answers = family === 4 || family === 6 ? pinned.filter((entry) => entry.family === family) : pinned
    const first = answers[0]
    process.nextTick(() => {
      if (!first) callback(new HttpClientError('blocked_destination', 'no approved address for this connection'), '', 0)
      else if (options.all) callback(null, answers, 0)
      else callback(null, first.address, first.family)
    })
  }
}

function toResponse(response: IncomingMessage): Response {
  const status = response.statusCode ?? 0
  if (status < 200 || status > 599) {
    throw new Error(`upstream answered with the unusable status ${status}`)
  }

  const bodiless = BODILESS_STATUSES.has(status)
  let encodings: readonly string[] = []
  if (!bodiless) {
    try {
      encodings = contentEncodings(response.headers['content-encoding'])
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('unsupported content encoding')
      response.destroy(failure)
      throw failure
    }
  }

  let stream: Readable = response
  for (const encoding of [...encodings].reverse()) {
    const decoder = decoderFor(encoding)
    if (!decoder) {
      const failure = new HttpClientError('unsupported_content_encoding', 'unsupported content encoding')
      response.destroy(failure)
      throw failure
    }
    stream.on('error', (error) => decoder.destroy(error))
    decoder.on('close', () => {
      if (!response.readableEnded) response.destroy()
    })
    stream = stream.pipe(decoder)
  }

  const headers = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || name.toLowerCase() === 'set-cookie') continue
    for (const single of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, single)
      } catch {}
    }
  }
  if (encodings.length > 0) {
    headers.delete('content-encoding')
    headers.delete('content-length')
  }

  if (bodiless) response.resume()

  // SAFETY: Node's `Readable.toWeb` and global `Response` use the same runtime
  // WHATWG stream; `@types/node` and `lib.dom` declare separate TypeScript types.
  return new Response(bodiless ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>), { status, headers })
}

function contentEncodings(value: string | string[] | undefined): readonly string[] {
  const raw = Array.isArray(value) ? value.join(',') : value
  if (raw === undefined || raw.trim() === '') return []
  const encodings = raw.split(',').map((entry: string) => entry.trim().toLowerCase())

  if (encodings.some((encoding) => encoding === '') || (encodings.includes('identity') && encodings.length > 1)) {
    throw new HttpClientError('unsupported_content_encoding', 'malformed content encoding')
  }
  for (const encoding of encodings) {
    if (encoding !== 'identity' && !decoderFor(encoding)) {
      throw new HttpClientError('unsupported_content_encoding', 'unsupported content encoding')
    }
  }
  return encodings.filter((encoding) => encoding !== 'identity')
}

function decoderFor(encoding: string): Duplex | undefined {
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip()
  if (encoding === 'deflate') return createInflate()
  if (encoding === 'br') return createBrotliDecompress()
  return undefined
}

function reasonFor(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('the retrieval was abandoned')
}

function observeConnection(outbound: ClientRequest): () => HttpTimings {
  const startedAt = performance.now()
  let reused = false
  let socketAt: number | undefined
  let connectAt: number | undefined
  let secureAt: number | undefined

  outbound.on('socket', (socket) => {
    socketAt = performance.now()
    reused = outbound.reusedSocket
    if (reused) return
    socket.once('connect', () => {
      connectAt = performance.now()
    })
    socket.once('secureConnect', () => {
      secureAt = performance.now()
    })
  })

  return () => {
    const readyAt = secureAt ?? connectAt ?? socketAt ?? startedAt
    return {
      connectionReused: reused,
      ...(connectAt !== undefined ? { connectMs: elapsedMs(socketAt ?? startedAt, connectAt) } : {}),
      ...(secureAt !== undefined && connectAt !== undefined ? { tlsMs: elapsedMs(connectAt, secureAt) } : {}),
      ttfbMs: elapsedMs(readyAt),
    }
  }
}
