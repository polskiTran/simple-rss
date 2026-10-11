import type {
  Digest,
  DigestGroup,
  DigestItem,
  FeedAvailability,
  FeedDetail,
  FeedItemRow,
  FeedPreview,
  Library,
  LibraryItem,
  ReaderArticle,
  ReaderItem,
  SearchResult,
  SubscriptionSummary,
} from '../../src/shared/api.js'

/**
 * Well-formed API answers for client tests, all about one Feed — Field Notes,
 * feed 1 — and its item First light, item 3, on Saturday 8 August 2026. Each
 * builder takes overrides for whole fields; a test states only what it is about.
 */

const TODAY = '2026-08-08'

export const availability = (overrides: Partial<FeedAvailability> = {}): FeedAvailability => ({
  state: 'available',
  lastCheckedAt: '2026-08-08T09:00:00.000Z',
  lastSuccessDate: TODAY,
  consecutiveFailures: 0,
  category: null,
  ...overrides,
})

export const UNCHECKED = availability({
  state: 'unchecked',
  lastCheckedAt: null,
  lastSuccessDate: null,
})

const FEED = {
  feedId: 1,
  title: 'Field Notes',
  description: null,
  domain: 'journal.example',
  homePageUrl: 'https://journal.example/',
  enteredUrl: 'https://journal.example/feed',
  resolvedUrl: 'https://feeds.example/journal.xml',
  readingSource: 'original-webpage',
} as const satisfies Partial<FeedDetail>

/** A row of the Feeds list. */
export const subscription = (overrides: Partial<SubscriptionSummary> = {}): SubscriptionSummary => ({
  ...FEED,
  subscribedAt: '2026-08-01T09:00:00.000Z',
  cadence: Array.from({ length: 30 }, () => 0),
  availability: availability(),
  ...overrides,
})

/** Field Notes as the Add feed dialog previews it, before it is recorded: one item, at noon on the fixtures' day. */
export const feedPreview = (overrides: Partial<FeedPreview> = {}): FeedPreview => ({
  feedUrl: FEED.enteredUrl,
  title: FEED.title,
  domain: FEED.domain,
  homePageUrl: FEED.homePageUrl,
  cadence: Array.from({ length: 30 }, (_, day) => (day === 29 ? 1 : 0)),
  lastItemAt: `${TODAY}T12:00:00.000Z`,
  items: [{ title: 'First light', publishedAt: `${TODAY}T12:00:00.000Z` }],
  subscribed: false,
  ...overrides,
})

/** One item on an opened Feed's page. */
export const feedItemRow = (overrides: Partial<FeedItemRow> = {}): FeedItemRow => ({
  feedItemId: 3,
  title: 'First light',
  link: 'https://journal.example/first-light',
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  date: TODAY,
  displayTime: '07:15',
  saved: false,
  ...overrides,
})

/** An opened Feed: by default no Cadence and First light as its one item. */
export const feedDetail = (overrides: Partial<FeedDetail> = {}): FeedDetail => ({
  ...FEED,
  reportedTitle: FEED.title,
  customTitle: null,
  reportedDescription: null,
  customDescription: null,
  availability: availability(),
  schedule: { pollingIntervalMinutes: 120, nextPollAt: '2026-08-08T11:00:00.000Z' },
  subscribedDate: '2026-08-01',
  cadence: [],
  items: [feedItemRow()],
  ...overrides,
})

export const digestItem = (overrides: Partial<DigestItem> = {}): DigestItem => ({
  feedItemId: 3,
  title: 'First light',
  feedId: FEED.feedId,
  feedTitle: FEED.title,
  link: 'https://journal.example/first-light',
  publishedAt: '2026-08-08T07:15:00.000Z',
  displayTime: '07:15',
  imageUrl: null,
  summary: null,
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  saved: false,
  ...overrides,
})

/** A day of the Digest; Today unless told otherwise. */
export const digestGroup = (overrides: Partial<DigestGroup> = {}): DigestGroup => ({
  date: TODAY,
  items: [digestItem()],
  returns: [],
  ...overrides,
})

/** One Digest page: by default today alone, holding First light, and nothing older. */
export const digest = (overrides: Partial<Digest> = {}): Digest => ({
  today: TODAY,
  groups: [digestGroup()],
  nextFrom: null,
  ...overrides,
})

export const readerItem = (overrides: Partial<ReaderItem> = {}): ReaderItem => ({
  feedItemId: 3,
  title: 'First light',
  feedId: FEED.feedId,
  feedTitle: FEED.title,
  link: 'https://journal.example/first-light',
  discussionUrl: null,
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  date: TODAY,
  today: TODAY,
  summary: 'A clear morning over the valley.',
  saved: false,
  readingSource: 'original-webpage',
  feedContent: null,
  nextInDigest: null,
  ...overrides,
})

export const readerArticle = (overrides: Partial<ReaderArticle> = {}): ReaderArticle => ({
  feedItemId: 3,
  markdown: 'The valley turns from grey to gold.',
  readingTimeMinutes: 1,
  ...overrides,
})

export const libraryItem = (overrides: Partial<LibraryItem> = {}): LibraryItem => ({
  feedItemId: 3,
  title: 'First light',
  feedId: FEED.feedId,
  feedTitle: FEED.title,
  subscribed: true,
  link: 'https://journal.example/first-light',
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  savedAt: '2026-08-08T09:05:00.000Z',
  savedDate: TODAY,
  ...overrides,
})

/**
 * A Library page: by default two saves — First light today, and A June letter
 * from The Slow Press saved on 28 July — and nothing further.
 */
export const library = (overrides: Partial<Library> = {}): Library => {
  const items = overrides.items ?? [
    libraryItem(),
    libraryItem({
      feedItemId: 1,
      title: 'A June letter',
      feedId: 2,
      feedTitle: 'The Slow Press',
      link: null,
      publishedAt: '2026-06-03T12:00:00.000Z',
      firstSeenAt: '2026-06-03T13:00:00.000Z',
      savedAt: '2026-07-28T08:00:00.000Z',
      savedDate: '2026-07-28',
    }),
  ]
  return { today: TODAY, total: items.length, nextCursor: null, ...overrides, items }
}

export const searchResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  feedItemId: 3,
  title: 'First light',
  feedId: FEED.feedId,
  feedTitle: FEED.title,
  publishedAt: '2026-08-08T07:15:00.000Z',
  firstSeenAt: '2026-08-08T09:00:00.000Z',
  date: TODAY,
  displayTime: '07:15',
  saved: false,
  snippet: null,
  ...overrides,
})
