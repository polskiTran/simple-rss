import { BroadcastChannel, parentPort, workerData } from 'node:worker_threads'
import { signReaderImageUrl } from '../../src/server/images/image-url-signature.js'
import { extractArticle } from '../../src/server/reader/extract-article.js'
import {
  readerWorkerDataSchema,
  type ReaderWorkerReply,
  readerWorkerRequestSchema,
  type ReaderWorkerRequest,
} from '../../src/server/reader/reader-extractor.js'
import { readerWorkerFixtureDirectiveSchema, type ReaderWorkerFixtureDirective } from './reader-worker-fixtures.js'

/**
 * The production extraction worker plus fault injection: it speaks the real
 * request and reply schemas and extracts for real, but an armed directive
 * makes the next task crash the thread or park it in `Atomics.wait` until the
 * test releases the shared state. `ReaderWorkerFixtures` names the channel in
 * this module's URL query and arms directives over it.
 */
const channelName = new URL(import.meta.url).searchParams.get('channel')
if (!channelName) throw new Error(`Reader worker fixture requires a channel query: ${import.meta.url}`)
if (!parentPort) throw new Error('Reader worker fixture requires a parent port')
const port = parentPort
const imageSigningKey = readerWorkerDataSchema.parse(workerData).imageSigningKey

let pending: ReaderWorkerFixtureDirective | undefined
const channel = new BroadcastChannel(channelName)
channel.unref()
channel.onmessage = (event) => {
  pending = readerWorkerFixtureDirectiveSchema.parse((event as { data: unknown }).data)
  channel.postMessage({ kind: 'armed' })
}
channel.postMessage({ kind: 'ready' })

port.on('message', (value) => {
  const request = readerWorkerRequestSchema.parse(value)
  const directive = pending
  pending = undefined
  if (directive?.kind === 'crash') throw new Error('Reader worker fixture crash requested')
  if (directive?.kind === 'hold') hold(directive.state)
  void run(request)
})

async function run(request: ReaderWorkerRequest): Promise<void> {
  const { article, timings } = await extractArticle({
    bytes: new Uint8Array(request.bytes),
    charset: request.charset,
    url: request.url,
    signImageUrl: (url) =>
      signReaderImageUrl({
        key: imageSigningKey,
        nowMilliseconds: request.nowMilliseconds,
        url,
      }),
  })
  const reply: ReaderWorkerReply = article
    ? { id: request.id, kind: 'extracted', article, timings }
    : { id: request.id, kind: 'unreadable', timings }
  port.postMessage(reply)
}

function hold(state: SharedArrayBuffer): void {
  const view = new Int32Array(state)
  Atomics.store(view, 0, 1)
  Atomics.notify(view, 0)
  while (Atomics.load(view, 0) === 1) Atomics.wait(view, 0, 1)
}
