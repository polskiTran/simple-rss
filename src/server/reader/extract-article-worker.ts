import { parentPort, workerData } from 'node:worker_threads'
import { signReaderImageUrl } from '../images/image-url-signature.js'
import { extractArticle } from './extract-article.js'
import {
  readerWorkerDataSchema,
  type ReaderWorkerReply,
  readerWorkerRequestSchema,
  type ReaderWorkerRequest,
} from './reader-extractor.js'

if (!parentPort) throw new Error('Reader extraction worker requires a parent port')
const data = readerWorkerDataSchema.parse(workerData)
const port = parentPort
const imageSigningKey = data.imageSigningKey

port.on('message', (value) => {
  const request = readerWorkerRequestSchema.parse(value)
  if (request.directive?.kind === 'crash') throw new Error('Reader extraction worker crash requested')
  if (request.directive?.kind === 'hold') hold(request.directive.state)
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
