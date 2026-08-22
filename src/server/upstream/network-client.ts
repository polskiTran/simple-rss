import { lookup as systemLookup, type LookupAddress, type LookupOptions } from 'node:dns'
import { Agent as HttpAgent, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable, type Duplex } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { isPublicAddress, unbracket } from './addresses.js'
import { HttpClientError, type HttpClient } from './http-client.js'

const ACCEPT_ENCODING = 'gzip, deflate, br'

/** Statuses defined to carry no body; `Response` throws if given one. */
const BODILESS_STATUSES = new Set([204, 205, 304])

export interface NetworkHttpClientOptions {
  readonly isAllowedAddress?: (address: string) => boolean
  readonly lookup?: LookupFunction
}

export function createNetworkHttpClient(options: NetworkHttpClientOptions = {}): HttpClient {
  const isAllowed = options.isAllowedAddress ?? isPublicAddress
  const resolvingLookup = guardedLookup(isAllowed, options.lookup ?? systemLookup)
  // A socket lives only while an admitted retrieval uses it, so the gates in
  // `retrieval.ts` are the socket budget. Keep-alive would leave idle sockets
  // no budget covers, and a cap on those can only block admitted work.
  const agentOptions = { keepAlive: false }
  const httpAgent = new HttpAgent(agentOptions)
  const httpsAgent = new HttpsAgent(agentOptions)

  return async (request, addresses) => {
    const url = new URL(request.url)
    const secure = url.protocol === 'https:'
    if (!secure && url.protocol !== 'http:') {
      throw new Error(`refusing to retrieve over ${url.protocol}`)
    }

    // An address literal never reaches the resolver, so it is judged here;
    // names are judged inside `lookup`, below.
    const host = unbracket(url.hostname)
    if (isIP(host) !== 0 && !isAllowed(host)) {
      throw new HttpClientError('blocked_destination', 'socket address is not globally reachable')
    }

    const lookup = addresses ? preresolvedLookup(addresses, isAllowed) : resolvingLookup

    const headers: OutgoingHttpHeaders = {}
    request.headers.forEach((value, name) => {
      headers[name] = value
    })
    headers['accept-encoding'] ??= ACCEPT_ENCODING

    const outbound = (secure ? httpsRequest : httpRequest)(url, {
      method: request.method,
      headers,
      lookup,
      agent: secure ? httpsAgent : httpAgent,
    })

    const { signal } = request
    if (signal.aborted) {
      outbound.destroy()
      throw reasonFor(signal)
    }
    const abandon = (): void => void outbound.destroy(reasonFor(signal))
    signal.addEventListener('abort', abandon, { once: true })
    outbound.on('close', () => signal.removeEventListener('abort', abandon))

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      outbound.on('response', resolve)
      outbound.on('error', reject)

      if (request.body) Readable.fromWeb(request.body as never).pipe(outbound)
      else outbound.end()
    })

    return toResponse(request, response)
  }
}

/**
 * Checks addresses inside the lookup the socket itself performs, closing the
 * re-resolution window between check and connect; one refused address refuses
 * the whole name.
 */
export function guardedLookup(
  isAllowed: (address: string) => boolean = isPublicAddress,
  lookup: LookupFunction = systemLookup,
): LookupFunction {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (error, answer, family) => {
      if (error) {
        callback(new HttpClientError('unresolvable_host', 'host did not resolve'), '', 0)
        return
      }

      const answers: LookupAddress[] = Array.isArray(answer)
        ? answer
        : [{ address: answer, family: family === 6 ? 6 : 4 }]
      answerSocket(answers, isAllowed, options, callback)
    })
  }
}

function preresolvedLookup(
  addresses: readonly [string, ...string[]],
  isAllowed: (address: string) => boolean,
): LookupFunction {
  const answers = addresses.map((address) => ({ address, family: isIP(address) }))
  return (_hostname, options, callback) => answerSocket(answers, isAllowed, options, callback)
}

type LookupCallback = Parameters<LookupFunction>[2]

function answerSocket(
  answers: readonly LookupAddress[],
  isAllowed: (address: string) => boolean,
  options: LookupOptions,
  callback: LookupCallback,
): void {
  if (answers.some((entry) => !isAllowed(entry.address))) {
    callback(new HttpClientError('blocked_destination', 'host resolves to a non-global address'), '', 0)
    return
  }

  const first = answers[0]
  if (!first) {
    callback(new HttpClientError('unresolvable_host', 'host did not resolve'), '', 0)
    return
  }

  if (options.all) callback(null, answers as never, 0)
  else callback(null, first.address, first.family)
}

function toResponse(request: Request, response: IncomingMessage): Response {
  const status = response.statusCode ?? 0
  if (status < 200 || status > 599) {
    throw new Error(`upstream answered with the unusable status ${status}`)
  }

  const bodiless = BODILESS_STATUSES.has(status) || request.method === 'HEAD'
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
    // Cancelling the final decoded stream must tear down the socket beneath
    // every decoder rather than draining bytes nobody wants.
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
