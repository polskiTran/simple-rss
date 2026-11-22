import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  digestSchema,
  LIBRARY_PAGE_SIZE,
  librarySchema,
  MAX_FEED_TITLE_LENGTH,
  SEARCH_SUBSCRIPTION_LIMIT,
  searchResultsSchema,
} from '../../src/shared/api.js'
import { install } from '../../src/client/dev/worst-case.js'

const realFetch = window.fetch

async function mocked(dataset: string, path: string): Promise<unknown> {
  window.history.replaceState(null, '', `/?data=${dataset}`)
  install()
  const response = await window.fetch(path)
  return response.json()
}

describe('the dev worst-case mock', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => {
    window.fetch = realFetch
    document.body.replaceChildren()
  })

  it('pages the huge Library at the shared page size', async () => {
    const library = librarySchema.parse(await mocked('huge', '/api/library'))

    expect(library.items).toHaveLength(LIBRARY_PAGE_SIZE)
  })

  it('cuts the longest Feed Item title at the shared title bound', async () => {
    const digest = digestSchema.parse(await mocked('worst', '/api/digest'))
    const longest = Math.max(...digest.groups.flatMap((group) => group.items.map((item) => item.title.length)))

    expect(longest).toBe(MAX_FEED_TITLE_LENGTH)
  })

  it.each(['q=hi', 'q=hi&in=saved', 'q=hi&in=subscriptions', 'q=hi&feed=1'])(
    'answers a Search for %s in the Search response shape',
    async (query) => {
      const answered = searchResultsSchema.parse(await mocked('worst', `/api/search?${query}`))

      expect('results' in answered ? answered.results : answered.subscriptions).not.toHaveLength(0)
    },
  )

  it('fills the Jump-to Group from its own Feeds, up to the shared limit', async () => {
    const answered = searchResultsSchema.parse(await mocked('huge', '/api/search?q=hi'))

    expect(answered.scope === 'everywhere' && answered.subscriptions).toHaveLength(SEARCH_SUBSCRIPTION_LIMIT)
  })
})
