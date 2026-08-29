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
  void run(readerWorkerRequestSchema.parse(value))
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
