import type { ReaderArticle, ReaderDeadlineStage } from '../shared/api.js'
import { ApiError, fetchReaderArticle } from './api.js'

const DEADLINE_REFETCH_DELAY_MS = 2_000
const DEADLINE_REFETCH_ATTEMPTS = 2

export const STAGE_NOTES = {
  publisher: 'Waiting on the publisher',
  parsing: 'Still reading the original webpage',
} as const satisfies Record<ReaderDeadlineStage, string>

export function deadlineStage(cause: unknown): ReaderDeadlineStage | undefined {
  return cause instanceof ApiError && cause.failure.code === 'article_deadline_exceeded'
    ? cause.failure.stage
    : undefined
}

export async function fetchArticleThroughDeadlines(
  feedItemId: number,
  signal: AbortSignal,
  onWaiting: (stage: ReaderDeadlineStage) => void,
): Promise<ReaderArticle> {
  for (let refetch = 0; ; refetch += 1) {
    try {
      return await fetchReaderArticle(feedItemId, signal)
    } catch (cause) {
      const stage = deadlineStage(cause)
      if (stage === undefined || refetch >= DEADLINE_REFETCH_ATTEMPTS) throw cause
      onWaiting(stage)
      await pause(DEADLINE_REFETCH_DELAY_MS, signal)
      if (signal.aborted) throw cause
    }
  }
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}
