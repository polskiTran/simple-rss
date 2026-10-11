import type { Page } from '@playwright/test'
import { apiErrorSchema } from '../../src/shared/api.js'
import {
  addFeed,
  expect,
  expectNoHorizontalOverflow,
  READER_DEADLINE_BUDGET_MS,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

async function subscribe(page: Page, installation: Installation, feedUrl = installation.feedUrl): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await subscribeTo(page, feedUrl)
}

async function subscribeTo(page: Page, feedUrl: string): Promise<void> {
  await section(page, 'Feeds').click()
  await addFeed(page, feedUrl)
}

/** A section's link in the chrome; exact, since a back button names the same section. */
function section(page: Page, name: 'Digest' | 'Feeds' | 'Saved') {
  return page.getByRole('link', { name, exact: true })
}

async function preferFeedContent(page: Page, feedTitle: string): Promise<void> {
  await page.getByRole('link', { name: feedTitle }).click()
  await page.getByRole('button', { name: 'Feed content' }).click()
  await expect(page.getByText('Items now open with the feed content.')).toBeVisible()
}

const rendererChunk = /article-renderer|article-markdown/

test.describe('Reader View', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('reads structured Feed Content while the original is pending, then replaces it honestly', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()
    const held = Promise.withResolvers<void>()
    await page.route('**/api/items/*/reader', async (route) => {
      await held.promise
      await route.continue()
    })
    try {
      await page.getByRole('link', { name: 'First light' }).click()
      await expect(page.getByRole('heading', { name: 'From the field' })).toBeVisible()
      await expect(page.locator('.reader-meta')).toContainText('Feed content for now')
      await expect(page.locator('.reader-meta')).toContainText('1 min read')
      await expect(page.getByText('Reading the original webpage')).toBeVisible()
      const link = page.getByRole('link', { name: 'the feed notebook' })
      await expect(link).toHaveAttribute('href', 'https://publisher.example/feed-notes')
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(page.locator('.article-body em')).toHaveText('carefully')
      await expect(page.locator('.article-body li')).toHaveText('Keep a steady hand')
      const illustration = page.getByRole('img', { name: 'The valley in the Feed' })
      await expect(illustration).toHaveAttribute('src', /^\/api\/reader\/image\?url=.+&exp=\d+&sig=[\w-]+$/)
      await expect(illustration).toHaveAttribute('loading', 'lazy')
      await expect(illustration).toHaveJSProperty('naturalWidth', 1)
      await expect(page.getByText('The first light from the Feed.')).toBeVisible()
    } finally {
      held.resolve()
    }
    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'From the field' })).toHaveCount(0)
    await expect(page.locator('.reader-meta')).not.toContainText('for now')
    await expect(page.getByRole('button', { name: 'Original webpage' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('uses the Subscription source and a view-only switch cannot be overwritten by an old response', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await preferFeedContent(page, 'Field Notes')
    await section(page, 'Digest').click()

    const held = Promise.withResolvers<void>()
    const articleRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('/reader')) articleRequests.push(request.url())
    })
    await page.route('**/api/items/*/reader', async (route) => {
      await held.promise
      try {
        await route.continue()
      } catch {}
    })

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'From the field' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Feed content' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.reader-meta')).not.toContainText('for now')
    expect(articleRequests).toHaveLength(0)

    await page.getByRole('button', { name: 'Original webpage' }).click()
    await expect.poll(() => articleRequests.length).toBe(1)
    await expect(page.getByText('Reading the original webpage')).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Feed content for now')
    await page.getByRole('button', { name: 'Feed content' }).click()
    held.resolve()

    await expect(page.getByRole('heading', { name: 'From the field' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Field methods' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Feed content' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('link', { name: 'Back to Digest' }).click()
    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'From the field' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Feed content' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('opens from the Digest, reads clean structured content, and returns', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page).toHaveURL(/\/reader\/\d+$/)

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await expect(page.getByText('A clear morning.')).toBeVisible()
    await expect(page.getByText('Reading the original webpage')).toBeVisible()
    const meta = page.locator('.reader-meta')
    await expect(meta).toContainText('Field Notes')
    await expect(meta).toContainText(/\d+ min read/)
    const original = page.getByRole('link', { name: 'Open original' })
    await expect(original).toHaveAttribute('href', 'https://publisher.example/first-light')
    await expect(original).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(original).toHaveAttribute('target', '_blank')

    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    await expect(page.getByText('arrive before the light')).toBeVisible()
    await expect(page.locator('.article-body pre code')).toContainText('def observe()')

    const codeLines = page.locator('.article-body pre code > span')
    await expect(codeLines).toHaveCount(4)
    const firstLine = await codeLines.first().boundingBox()
    const lastLine = await codeLines.last().boundingBox()
    expect(lastLine?.y ?? 0).toBeGreaterThan(firstLine?.y ?? 0)
    await expect(page.locator('.article-body pre code span[style*="--shiki-dark"]').first()).toBeVisible()

    await expect(page.locator('.article-body .katex')).toHaveCount(2)

    const equation = page.locator('.article-body .katex-display')
    const equationLayout = await equation.evaluate((element) => {
      const bases = [...element.querySelectorAll('.katex-html > .base')]
      return {
        scrolls: element.scrollWidth > element.clientWidth,
        clear: element.querySelector('.tag')!.getBoundingClientRect().left,
        formulaEnds: Math.max(...bases.map((base) => base.getBoundingClientRect().right)),
      }
    })
    expect(equationLayout.scrolls).toBe(true)
    expect(equationLayout.clear).toBeGreaterThan(equationLayout.formulaEnds)
    await expectNoHorizontalOverflow(page)

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    expect(await page.locator('.article-body iframe, .article-body form, .article-body script').count()).toBe(0)
    await expect(page.getByText('Subscribe now')).toHaveCount(0)

    const noteLink = page.getByRole('link', { name: /the notebook/ })
    await expect(noteLink).toHaveAttribute('href', 'https://publisher.example/notes')
    await expect(noteLink).toHaveAttribute('rel', 'noopener noreferrer')

    const figureImage = page.locator('.article-body img.article-image')
    await expect(figureImage).toHaveAttribute('src', /^\/api\/reader\/image\?/)
    await expect(figureImage).toHaveAttribute('alt', 'the valley at dawn')
    await expect(figureImage).toHaveJSProperty('naturalWidth', 1)
    await expect(page.locator('.article-body')).not.toContainText('fl_progressive')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()

    await page.getByRole('link', { name: 'Back to Digest' }).click()
    await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
  })

  test('brings its Markdown renderer down with the first article, not with the app', async ({ page, installation }) => {
    const renderer: string[] = []
    page.on('request', (request) => {
      if (rendererChunk.test(request.url())) renderer.push(request.url())
    })

    await subscribe(page, installation)
    await section(page, 'Digest').click()
    await expect(page.getByRole('link', { name: 'First light' })).toBeVisible()
    expect(renderer).toHaveLength(0)

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.locator('.article-body')).toBeVisible()
    expect(renderer.length).toBeGreaterThan(0)
    expect(new Set(renderer).size).toBe(renderer.length)
  })

  test('starts the renderer download before the Reader response settles', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()
    await expect(page.getByRole('link', { name: 'First light' })).toBeVisible()

    const rendererRequested = page.waitForRequest(rendererChunk)
    await page.route('**/reader', async (route) => {
      await rendererRequested
      await route.continue()
    })

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByText('A clear morning.')).toBeVisible()
    await expect(page.getByText('Reading the original webpage')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    await expect(page.getByText('A clear morning.')).toHaveCount(0)
  })

  test('saves from the Reader and the Library agrees', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'First light' }).click()

    const toggle = page.getByRole('button', { name: 'Save First light' })
    await expect(toggle).toHaveText('Save')
    await toggle.click()
    const saved = page.getByRole('button', { name: 'Saved First light' })
    await expect(saved).toHaveText('Saved')
    await expect(saved).toHaveAttribute('aria-pressed', 'true')

    await section(page, 'Saved').click()
    await expect(page.getByRole('link', { name: 'First light' })).toBeVisible()
  })

  test('keeps structured Feed Content and rate-limits repeated parsing failures', async ({ page, installation }) => {
    await subscribe(page, installation, installation.brokenArticleFeedUrl)
    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'Slow water' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Slow water' })).toBeVisible()
    await expect(page.getByText('Tide notes from the shore.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Coastal notes' })).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Feed content')
    await expect(page.getByText('Shortened by simple. Open the original for the rest.')).toBeVisible()
    const originals = page.getByRole('link', { name: 'Open original' })
    await expect(originals).toHaveCount(2)
    await expect(originals.first()).toHaveAttribute('href', 'https://publisher.example/slow-water')

    const retry = page.getByRole('button', { name: 'Retry' })
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const failed = page.waitForResponse((response) => response.url().endsWith('/reader'))
      await retry.click()
      expect((await failed).status()).toBe(502)
      await expect(page.getByText(/Wait \d+ seconds, then retry/)).toHaveCount(0)
    }

    const limited = page.waitForResponse((response) => response.url().endsWith('/reader'))
    await retry.click()
    expect((await limited).status()).toBe(429)
    await expect(page.getByText(/Wait \d+ seconds, then retry/)).toBeVisible()

    await page.getByRole('link', { name: 'Back to Digest' }).click()
    await expect(page.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save Slow water' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('never dead-ends: next in the digest walks to the following item', async ({ page, installation }) => {
    await subscribe(page, installation)
    await subscribeTo(page, installation.brokenArticleFeedUrl)
    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByText('Next in the digest')).toBeVisible()
    await page.getByRole('link', { name: 'Slow water' }).click()

    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Slow water' })).toBeVisible()
    await expect(page.getByText('Next in the digest')).toHaveCount(0)
  })

  test('walks Digest, Feed and Reader by attribution, and back the same way', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()

    await page.locator('.item-meta').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await expect(page.getByRole('link', { name: 'Back to Digest' })).toBeVisible()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await page.getByRole('link', { name: 'Back to Field Notes' }).click()

    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await page.getByRole('link', { name: 'Back to Digest' }).click()
    await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
  })

  test('returns a saved article to the library it was opened from', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()
    await page.getByRole('button', { name: 'Save First light' }).click()

    await section(page, 'Saved').click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to Saved' }).click()
    await expect(page).toHaveURL(/\/saved$/)
  })
})

test.describe('Reader View at the server deadline', () => {
  test.use({ viewport: { width: 1280, height: 800 }, readerBudgetMs: READER_DEADLINE_BUDGET_MS })

  test('keeps the summary through the deadline and refetches into the article by itself', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation, installation.slowArticleFeedUrl)
    await section(page, 'Digest').click()

    const deadline = page.waitForResponse((response) => response.url().endsWith('/reader'))
    await page.getByRole('link', { name: 'Slow ridge' }).click()

    await expect(page.getByText('The ridge holds its light.')).toBeVisible()
    await expect(page.getByText('Reading the original webpage')).toBeVisible()

    const answered = await deadline
    expect(answered.status()).toBe(504)
    const failure = apiErrorSchema.parse(await answered.json()).error
    expect(failure.code).toBe('article_deadline_exceeded')
    expect(failure.stage).toBe('publisher')
    expect(answered.headers()['cache-control']).toBe('no-store')

    await expect(page.getByText('The ridge holds its light.')).toBeVisible()
    await expect(page.getByText('Waiting on the publisher')).toBeVisible()
    await expect(page.getByText(/couldn’t be read/)).toHaveCount(0)

    const refetched = page.waitForResponse((response) => response.url().endsWith('/reader'))
    expect((await refetched).status()).toBe(200)

    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    await expect(page.getByText('The ridge holds its light.')).toHaveCount(0)
  })
})

test.describe('Reader View at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps a shortened Feed Content fallback safe and readable after failure', async ({ page, installation }) => {
    const publisherRequests: string[] = []
    page.on('request', (request) => {
      if (!request.url().startsWith(installation.url)) publisherRequests.push(request.url())
    })
    await subscribe(page, installation, installation.brokenArticleFeedUrl)
    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'Slow water' }).click()
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Coastal notes' })).toBeVisible()
    await expect(page.getByText('Shortened by simple. Open the original for the rest.')).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Feed content')
    await expect(page.getByRole('link', { name: 'the coastal notebook' })).toHaveAttribute(
      'href',
      'https://publisher.example/coastal-notes',
    )
    await expect(page.getByText('unsafe link text')).toBeVisible()
    await expect(page.getByRole('link', { name: 'unsafe link text' })).toHaveCount(0)
    await expect(page.locator('.article-body pre code')).toContainText('measure(tide)')
    await expect(page.locator('.article-body table')).toBeVisible()
    const illustration = page.getByRole('img', { name: 'Low tide on the coast' })
    await expect(illustration).toHaveAttribute('src', /^\/api\/reader\/image\?url=.+&exp=\d+&sig=[\w-]+$/)
    await expect(illustration).toHaveJSProperty('naturalWidth', 1)
    await expect(page.getByText('A study of the shore.')).toBeVisible()
    await expect(page.locator('.article-image-fallback')).toHaveText('Unavailable tide chart')
    await expect(page.locator('.article-body img')).toHaveCount(1)
    await expect(page.locator('.article-body script, .article-body iframe')).toHaveCount(0)
    await expect(page.getByText('Beyond the application limit.')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    expect(publisherRequests).toEqual([])
  })

  test('makes an image-only fallback useful, including alternative text when the image fails', async ({
    page,
    installation,
  }) => {
    const publisherRequests: string[] = []
    page.on('request', (request) => {
      if (!request.url().startsWith(installation.url)) publisherRequests.push(request.url())
    })
    await subscribe(page, installation, installation.imageOnlyFeedUrl)
    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'Moonrise' }).click()
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Feed content')
    await expect(page.getByText('A separate preview, not the drawing.')).toHaveCount(0)
    const image = page.getByRole('img', { name: 'The moon rises over a sleeping valley' })
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', /^\/api\/reader\/image\?url=.+&exp=\d+&sig=[\w-]+$/)
    await expect(image).toHaveAttribute('loading', 'lazy')
    await expect(image).toHaveJSProperty('naturalWidth', 1)
    await expectNoHorizontalOverflow(page)

    await page.route('**/api/reader/image?*', (route) => route.fulfill({ status: 404 }))
    await page.reload()
    await expect(page.locator('.article-image-fallback')).toHaveText('The moon rises over a sleeping valley')
    await expect(page.getByRole('heading', { name: 'Moonrise' })).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Feed content')
    await expectNoHorizontalOverflow(page)
    expect(publisherRequests).toEqual([])
  })

  test('keeps the same structure and stays readable', async ({ page, installation }) => {
    await subscribe(page, installation)
    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Field Notes')
    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    const back = page.getByRole('link', { name: 'Back to Digest' })
    await expect(back).toHaveCount(1)
    await expect(back).toHaveClass(/chrome-back/)

    // One top bar: the back square, then Open original, Save and search, in that order.
    const topBar = [
      back,
      page.getByRole('link', { name: 'Open original' }),
      page.getByRole('button', { name: 'Save First light' }),
      page.getByRole('button', { name: 'Search' }),
    ]
    const boxes = await Promise.all(topBar.map((control) => control.boundingBox()))
    for (const box of boxes) {
      expect(box?.height).toBe(44)
      expect(box?.y).toBe(boxes[0]?.y)
    }
    const lefts = boxes.map((box) => box?.x ?? Number.NaN)
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
    await expect(page.getByText('Next in the digest')).toHaveCount(0)

    await expect(page.getByText(/the-long-unbroken-address/)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
