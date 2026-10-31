/**
 * Dev-only data toggle (break-ui). Swaps the API's answers at the fetch
 * boundary for realistic worst-case datasets, so every screen meets the data
 * production will hand it. `main.tsx` installs it only under `import.meta.env.DEV`.
 *
 * `?data=worst|empty|one|huge` picks a dataset; the choice is kept in
 * sessionStorage so in-app navigation (which rewrites the URL) keeps it.
 * `demo` passes every request through to the real server.
 */
import type {
  DigestCalendar,
  Digest,
  DigestItem,
  FeedDetail,
  FeedItems,
  Library,
  LibraryItem,
  SubscriptionList,
  SubscriptionSummary,
} from '../../shared/api.js'

const DATASETS = ['demo', 'worst', 'empty', 'one', 'huge'] as const
type Dataset = (typeof DATASETS)[number]
const LABELS = {
  demo: 'Demo data',
  worst: 'Worst case',
  empty: 'Empty',
  one: 'One',
  huge: '1,000 rows',
} as const satisfies Record<Dataset, string>
const STORAGE_KEY = 'break-ui:data'

const TODAY = '2026-10-22'
const YESTERDAY = '2026-10-21'
const LAST_YEAR = '2025-12-31'

function isDataset(value: string | null): value is Dataset {
  return DATASETS.some((dataset) => dataset === value)
}

function chosenDataset(): Dataset {
  const fromUrl = new URLSearchParams(window.location.search).get('data')
  try {
    if (isDataset(fromUrl)) sessionStorage.setItem(STORAGE_KEY, fromUrl)
    const stored = sessionStorage.getItem(STORAGE_KEY)
    return isDataset(stored) ? stored : 'demo'
  } catch {
    return isDataset(fromUrl) ? fromUrl : 'demo'
  }
}

const quietCadence = Array.from({ length: 30 }, () => 0)
const busyCadence = Array.from({ length: 30 }, (_, day) => (day % 3 === 0 ? 1_284 : day % 2))
const sparseCadence = Array.from({ length: 30 }, (_, day) => (day === 29 ? 1 : 0))

interface FeedSeed {
  readonly title: string
  readonly description?: string
  readonly domain: string
  readonly homePageUrl?: string
  readonly cadence?: readonly number[]
  readonly availability?: SubscriptionSummary['availability']
}

const available: SubscriptionSummary['availability'] = {
  state: 'available',
  lastCheckedAt: `${TODAY}T08:00:00Z`,
  lastSuccessDate: TODAY,
  consecutiveFailures: 0,
  category: null,
}

/** Spread across the first rows, one failure each, as real data mixes them. */
const WORST_FEEDS: readonly FeedSeed[] = [
  {
    title:
      'Aleksandra Wiśniewska-Kowalczyk — Notatki o projektowaniu systemów rozproszonych, ich nieoczywistych konsekwencjach i ludziach, którzy je utrzymują',
    description:
      'Długie eseje o infrastrukturze, zespołach i kompromisach. Publikowane nieregularnie, zwykle w niedzielę wieczorem, czasem trzy naraz.',
    domain: 'aleksandra.wisniewska-kowalczyk.example.com',
    homePageUrl: 'https://aleksandra.wisniewska-kowalczyk.example.com/notatki/',
    cadence: busyCadence,
  },
  // A feed with no <title>: the publisher's host is all it reports.
  {
    title: 'northwind-industries-holdings.example.com',
    domain: 'ops.sub.department.region.northwind-industries-holdings.example.co.uk',
    cadence: busyCadence,
  },
  { title: 'Jo', domain: 'jo.example.org', homePageUrl: 'https://jo.example.org/', cadence: sparseCadence },
  {
    title: '王秀英的技术博客',
    domain: 'wang.example.cn',
    homePageUrl: 'https://wang.example.cn/',
    cadence: busyCadence,
  },
  {
    title: 'نور الهدى عبد الرحمن — مدونة التصميم',
    domain: 'noor.example.sa',
    homePageUrl: 'https://noor.example.sa/',
    cadence: sparseCadence,
  },
  { title: '👩🏽‍💻 Priya ships things', domain: 'priya.example.dev', homePageUrl: 'https://priya.example.dev/' },
  {
    title: 'Benachrichtigungseinstellungsverwaltungsblog',
    domain: 'benachrichtigung.example.de',
    homePageUrl: 'https://benachrichtigung.example.de/',
    availability: {
      state: 'unavailable',
      lastCheckedAt: `${TODAY}T07:30:00Z`,
      lastSuccessDate: LAST_YEAR,
      consecutiveFailures: 1_284,
      category: 'unsupported_content',
    },
  },
  {
    title: 'Đặng Thị Ngọc Hân — Ghi chép thiết kế',
    domain: 'han.example.vn',
    homePageUrl: 'https://han.example.vn/',
    availability: {
      state: 'unchecked',
      lastCheckedAt: null,
      lastSuccessDate: null,
      consecutiveFailures: 0,
      category: null,
    },
  },
  {
    title: '<script>alert(1)</script> &amp; **Bold** Weekly',
    domain: 'escape.example.com',
    homePageUrl: 'https://escape.example.com/',
    cadence: busyCadence,
  },
  {
    title: 'Never reached',
    domain: 'gone.example.net',
    availability: {
      state: 'unavailable',
      lastCheckedAt: `${TODAY}T07:30:00Z`,
      lastSuccessDate: null,
      consecutiveFailures: 3,
      category: 'timeout',
    },
  },
  // Identical names: two Subscriptions to the same publisher's different Feeds.
  { title: 'Engineering', domain: 'blog.example.com', homePageUrl: 'https://blog.example.com/', cadence: busyCadence },
  { title: 'Engineering', domain: 'eng.example.org', homePageUrl: 'https://eng.example.org/', cadence: busyCadence },
]

function subscription(seed: FeedSeed, index: number): SubscriptionSummary {
  return {
    feedId: index + 1,
    title: seed.title,
    description: seed.description ?? null,
    domain: seed.domain,
    homePageUrl: seed.homePageUrl ?? null,
    enteredUrl: `https://${seed.domain}/feed.xml`,
    resolvedUrl: `https://${seed.domain}/feed.xml`,
    readingSource: 'original-webpage',
    subscribedAt: `2026-0${(index % 9) + 1}-15T12:00:00Z`,
    cadence: [...(seed.cadence ?? quietCadence)],
    availability: seed.availability ?? available,
  }
}

function hugeFeeds(): FeedSeed[] {
  return Array.from({ length: 1_000 }, (_, index) => {
    const seed = WORST_FEEDS[index % WORST_FEEDS.length] ?? { title: 'Feed', domain: 'feed.example.com' }
    return { ...seed, title: `${seed.title} ${index + 1}` }
  })
}

function feedsOf(dataset: Exclude<Dataset, 'demo'>): SubscriptionSummary[] {
  switch (dataset) {
    case 'worst':
      return WORST_FEEDS.map(subscription)
    case 'empty':
      return []
    case 'one':
      return [subscription({ title: 'Jo', domain: 'jo.example.org', cadence: sparseCadence }, 0)]
    case 'huge':
      return hugeFeeds().map(subscription)
  }
}

const LONG_TITLE =
  'Why we rewrote our entire distributed job scheduler three times in eighteen months, what each rewrite taught us about consensus, backpressure and on-call fatigue, and why the fourth version is, against every instinct we had, a single SQLite file on one machine'
// A Mastodon or Bluesky feed titles each item with the whole post; ingestion
// cuts it at MAX_TITLE_LENGTH (512), mid-word, as `feed-document.ts` does.
const POST_TITLE =
  'Small thread on what happened to our deploy pipeline last night, because a few of you asked and I think the failure mode is genuinely interesting: at 02:14 the artifact cache filled up, the cleanup job that was supposed to run at 02:00 had been silently disabled in a config migration three weeks ago, and every build after that point started falling back to a cold cache, which pushed build times from four minutes to forty-one, which tripped the deploy timeout, which the on-call runbook told us to fix by retrying, which made it worse. 1/9 #devops #postmortem'.slice(
    0,
    512,
  )
const LONG_SUMMARY =
  `${'In the spring we noticed that the scheduler was dropping roughly one job in ten thousand under load. '.repeat(20)}`.trim()

interface ItemSeed {
  readonly feed: number
  readonly title: string
  readonly time: string
  readonly summary?: string
  readonly saved?: boolean
  readonly link?: string | null
}

const WORST_TODAY: readonly ItemSeed[] = [
  { feed: 1, title: LONG_TITLE, time: '23:59', summary: LONG_SUMMARY, saved: true },
  {
    feed: 2,
    title:
      'https://northwind-industries-holdings.example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved',
    time: '22:10',
  },
  { feed: 3, title: 'J', time: '21:00', link: null },
  { feed: 4, title: '分布式系统中的一致性问题：从理论到实践的完整指南（第三部分）', time: '20:45' },
  { feed: 5, title: 'لماذا نعيد تصميم كل شيء من الصفر؟', time: '19:30' },
  { feed: 6, title: '🦊🦊🦊 Shipping notes, week 42 👩🏽‍💻', time: '18:00' },
  { feed: 6, title: POST_TITLE, time: '17:45' },
  // A feed item with no <title>: the server answers 'Untitled'.
  { feed: 8, title: 'Untitled', time: '17:15' },
  {
    feed: 9,
    title: '<b>Release</b> &amp; notes — **v2.0** is out',
    time: '16:00',
    summary: '<script>alert(1)</script>',
  },
  ...Array.from({ length: 1_284 }, (_, index) => ({
    feed: 2,
    title: `Build ${1_284 - index} passed on main — northwind-industries-holdings/monorepo@9f8e7d6c5b4a`,
    time: `${String(Math.floor((1_283 - index) / 60) % 24).padStart(2, '0')}:${String((1_283 - index) % 60).padStart(2, '0')}`,
  })),
  { feed: 11, title: 'Engineering update', time: '09:00' },
  { feed: 12, title: 'Engineering update', time: '08:00' },
  { feed: 7, title: 'Ein Beitrag', time: '00:00' },
]

function feedTitle(feeds: readonly SubscriptionSummary[], feedId: number): string {
  return feeds.find((feed) => feed.feedId === feedId)?.title ?? 'Unsubscribed feed'
}

let nextItemId = 1

function digestItem(seed: ItemSeed, date: string, feeds: readonly SubscriptionSummary[]): DigestItem {
  const at = `${date}T${seed.time}:00Z`
  return {
    feedItemId: nextItemId++,
    title: seed.title,
    feedId: seed.feed,
    feedTitle: feedTitle(feeds, seed.feed),
    link: seed.link === undefined ? `https://example.com/items/${nextItemId}` : seed.link,
    publishedAt: at,
    displayTime: seed.time,
    imageUrl: null,
    summary: seed.summary ?? null,
    firstSeenAt: at,
    saved: seed.saved ?? false,
  }
}

function digestOf(dataset: Exclude<Dataset, 'demo'>): Digest {
  nextItemId = 1
  const feeds = feedsOf(dataset)
  switch (dataset) {
    case 'worst':
      return {
        today: TODAY,
        groups: [
          {
            date: TODAY,
            items: WORST_TODAY.map((seed) => digestItem(seed, TODAY, feeds)),
            returns: [
              { feedId: 3, quietDays: 7, cadence: sparseCadence },
              { feedId: 5, quietDays: 59, cadence: sparseCadence },
              { feedId: 6, quietDays: 1_096, cadence: sparseCadence },
            ],
          },
          {
            date: YESTERDAY,
            items: [digestItem({ feed: 3, title: 'One item yesterday', time: '12:00' }, YESTERDAY, feeds)],
            returns: [],
          },
          {
            date: LAST_YEAR,
            items: [
              digestItem({ feed: 1, title: 'New Year’s Eve, across a year boundary', time: '23:30' }, LAST_YEAR, feeds),
            ],
            returns: [],
          },
        ],
        nextFrom: '2025-12-30',
      }
    case 'empty':
      return { today: TODAY, groups: [], nextFrom: null }
    case 'one':
      return {
        today: TODAY,
        groups: [
          { date: TODAY, items: [digestItem({ feed: 1, title: 'One', time: '09:00' }, TODAY, feeds)], returns: [] },
        ],
        nextFrom: null,
      }
    case 'huge':
      return {
        today: TODAY,
        groups: [
          {
            date: TODAY,
            items: feeds.map((feed, index) =>
              digestItem({ feed: feed.feedId, title: `${feed.title}: item ${index + 1}`, time: '12:00' }, TODAY, feeds),
            ),
            returns: [],
          },
        ],
        nextFrom: null,
      }
  }
}

// Days the Digest fixture fills report its real count, so the calendar and the
// list never disagree; the rest are patterned filler.
function calendarOf(dataset: Exclude<Dataset, 'demo'>): DigestCalendar {
  const listed = new Map(digestOf(dataset).groups.map((group) => [group.date, group.items.length]))
  const days = Array.from({ length: 26 * 7 }, (_, index) => {
    const date = new Date(Date.parse(`${TODAY}T12:00:00Z`) - (26 * 7 - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const filler = dataset === 'worst' ? (index % 5 === 0 ? 1_284 : index % 3) : 0
    return { date, count: listed.get(date) ?? filler }
  })
  return { today: TODAY, days, subscriptions: feedsOf(dataset).length }
}

function libraryOf(dataset: Exclude<Dataset, 'demo'>): Library {
  const feeds = feedsOf(dataset)
  const item = (seed: ItemSeed, savedDate: string, subscribed = true): LibraryItem => ({
    feedItemId: nextItemId++,
    title: seed.title,
    feedId: seed.feed,
    feedTitle: subscribed ? feedTitle(feeds, seed.feed) : 'A feed you unsubscribed from long ago',
    subscribed,
    link: seed.link === undefined ? 'https://example.com/item' : seed.link,
    publishedAt: `${savedDate}T${seed.time}:00Z`,
    firstSeenAt: `${savedDate}T${seed.time}:00Z`,
    savedAt: `${savedDate}T${seed.time}:00Z`,
    savedDate,
  })
  switch (dataset) {
    case 'worst':
      return {
        today: TODAY,
        total: 1_284,
        items: [
          item({ feed: 1, title: LONG_TITLE, time: '23:59' }, TODAY),
          item({ feed: 2, title: WORST_TODAY[1]?.title ?? '', time: '10:00' }, YESTERDAY),
          item({ feed: 99, title: 'Saved from a Feed that is gone', time: '09:00' }, LAST_YEAR, false),
          item({ feed: 3, title: 'J', time: '08:00', link: null }, '1970-01-01'),
        ],
        nextCursor: 'more',
      }
    case 'empty':
      return { today: TODAY, total: 0, items: [], nextCursor: null }
    case 'one':
      return {
        today: TODAY,
        total: 1,
        items: [item({ feed: 1, title: 'One', time: '09:00' }, TODAY)],
        nextCursor: null,
      }
    case 'huge':
      return {
        today: TODAY,
        total: 1_000,
        // The server pages the Library at 50 (LIBRARY_PAGE_SIZE), so 1,000 saves arrive 50 at a time.
        items: feeds
          .slice(0, 50)
          .map((feed) => item({ feed: feed.feedId, title: `${feed.title}: saved`, time: '12:00' }, TODAY)),
        nextCursor: 'more',
      }
  }
}

function feedDetailOf(dataset: Exclude<Dataset, 'demo'>, feedId: number): FeedDetail | undefined {
  const feed = feedsOf(dataset).find((candidate) => candidate.feedId === feedId)
  if (!feed) return undefined
  return {
    ...feed,
    reportedTitle: feed.title,
    customTitle: null,
    reportedDescription: feed.description,
    customDescription: null,
    schedule: { pollingIntervalMinutes: 1440, nextPollAt: `${TODAY}T23:00:00Z` },
    subscribedDate: feed.subscribedAt.slice(0, 10),
    cadence: calendarOf(dataset).days,
  }
}

function feedItemsOf(dataset: Exclude<Dataset, 'demo'>, feedId: number): FeedItems {
  const digest = digestOf(dataset)
  return {
    items: digest.groups.flatMap((group) =>
      group.items
        .filter((item) => item.feedId === feedId)
        .map((item) => ({
          feedItemId: item.feedItemId,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          firstSeenAt: item.firstSeenAt,
          date: group.date,
          displayTime: item.displayTime,
          saved: item.saved,
        })),
    ),
    nextFrom: null,
  }
}

function answer(dataset: Exclude<Dataset, 'demo'>, method: string, path: string) {
  if (path === '/api/auth/status') return { claimed: true, authenticated: true }
  if (path === '/api/meta') return { name: 'simple-rss', version: '0.0.0-worst-case' }
  if (path === '/api/settings') return { timezone: 'America/Argentina/ComodRivadavia' }
  if (path === '/api/feeds') return { subscriptions: feedsOf(dataset) } satisfies SubscriptionList
  if (path === '/api/digest') return digestOf(dataset)
  if (path === '/api/digest/days') return calendarOf(dataset)
  if (path === '/api/library') return libraryOf(dataset)
  const library = path.match(/^\/api\/library\/(\d+)$/)
  if (library) {
    const saved = method === 'PUT'
    return { feedItemId: Number(library[1]), saved, savedAt: saved ? new Date().toISOString() : null }
  }
  const items = path.match(/^\/api\/feeds\/(\d+)\/items$/)
  if (items) return feedItemsOf(dataset, Number(items[1]))
  const detail = path.match(/^\/api\/feeds\/(\d+)$/)
  if (detail && method === 'GET') return feedDetailOf(dataset, Number(detail[1]))
  return undefined
}

export function install() {
  const dataset = chosenDataset()
  mountToggle(dataset)
  if (dataset === 'demo') return

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const body = answer(dataset, method, url.pathname)
    if (body === undefined) return realFetch(input, init)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

/** Plain chrome, deliberately outside the design system: it is not under test. */
function mountToggle(active: Dataset) {
  const bar = document.createElement('div')
  bar.setAttribute('role', 'radiogroup')
  bar.setAttribute('aria-label', 'Dev data')
  bar.style.cssText =
    'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:2px;padding:3px;background:#e5e5e5;border-radius:999px;font:500 12px system-ui,sans-serif;box-shadow:0 1px 3px rgb(0 0 0/.2)'
  for (const dataset of DATASETS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = LABELS[dataset]
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(dataset === active))
    button.style.cssText = `border:0;border-radius:999px;padding:4px 10px;cursor:pointer;color:#111;background:${dataset === active ? '#fff' : 'transparent'}`
    button.addEventListener('click', () => {
      try {
        sessionStorage.setItem(STORAGE_KEY, dataset)
      } catch {}
      const url = new URL(window.location.href)
      url.searchParams.set('data', dataset)
      window.location.replace(url)
    })
    bar.append(button)
  }
  document.body.append(bar)
}
