import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

async function subscribe(page: Page, installation: Installation, feedUrl = installation.feedUrl): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await subscribeTo(page, feedUrl)
}

async function subscribeTo(page: Page, feedUrl: string): Promise<void> {
  await page.getByRole('link', { name: 'feeds' }).click()
  await page.getByRole('textbox', { name: 'search or add feeds' }).fill(feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
}

test.describe('Reader View', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('opens from the Digest, reads clean structured content, and returns', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page).toHaveURL(/\/reader\/\d+$/)

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    const meta = page.locator('.reader-meta')
    await expect(meta).toContainText('Field Notes')
    await expect(meta).toContainText(/\d+ min/)
    const original = page.getByRole('link', { name: 'open original' })
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

    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('heading', { name: /today · 1 post/ })).toBeVisible()
  })

  test('brings its Markdown renderer down with the first article, not with the app', async ({ page, installation }) => {
    const renderer: string[] = []
    page.on('request', (request) => {
      if (/article-renderer|article-markdown/.test(request.url())) renderer.push(request.url())
    })

    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await expect(page.getByRole('link', { name: 'First light' })).toBeVisible()
    expect(renderer).toHaveLength(0)

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.locator('.article-body')).toBeVisible()
    expect(renderer.length).toBeGreaterThan(0)
  })

  test('saves from the Reader and the Library agrees', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('link', { name: 'First light' }).click()

    const toggle = page.getByRole('button', { name: 'save First light' })
    await expect(toggle).toHaveText('save')
    await toggle.click()
    await expect(toggle).toHaveText('saved')

    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByRole('link', { name: 'First light' })).toBeVisible()
  })

  test('falls back to the summary with a rate-limited retry when parsing fails', async ({ page, installation }) => {
    await subscribe(page, installation, installation.brokenArticleFeedUrl)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('link', { name: 'Slow water' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Slow water' })).toBeVisible()
    await expect(page.getByText('Tide notes from the shore.')).toBeVisible()
    const originals = page.getByRole('link', { name: 'open original' })
    await expect(originals).toHaveCount(2)
    await expect(originals.first()).toHaveAttribute('href', 'https://publisher.example/slow-water')

    await page.getByRole('button', { name: 'retry parsing' }).click()
    await expect(page.getByText('Tide notes from the shore.')).toBeVisible()
    await expect(page.getByText(/wait \d+s, then retry/)).toHaveCount(0)

    await page.getByRole('button', { name: 'retry parsing' }).click()
    await expect(page.getByText(/wait \d+s, then retry/)).toBeVisible()

    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'save Slow water' })).toHaveText('save')
  })

  test('never dead-ends: next in the digest walks to the following item', async ({ page, installation }) => {
    await subscribe(page, installation)
    await subscribeTo(page, installation.brokenArticleFeedUrl)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByText('next in the digest')).toBeVisible()
    await page.getByRole('link', { name: 'Slow water' }).click()

    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Slow water' })).toBeVisible()
    await expect(page.getByText('next in the digest')).toHaveCount(0)
  })

  test('walks Digest, Feed and Reader by attribution, and back the same way', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    await page.locator('.content-meta').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await expect(page.getByRole('link', { name: '← digest' })).toBeVisible()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await page.getByRole('link', { name: '← Field Notes' }).click()

    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('heading', { name: /today/ })).toBeVisible()
  })

  test('returns a saved article to the library it was opened from', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('button', { name: 'save First light' }).click()

    await page.getByRole('link', { name: 'saved' }).click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await page.getByRole('link', { name: '← saved' }).click()
    await expect(page).toHaveURL(/\/saved$/)
  })
})

test.describe('Reader View at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the same structure and stays readable', async ({ page, installation }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    await expect(page.locator('.reader-meta')).toContainText('Field Notes')
    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    await expect(page.getByText('next in the digest')).toHaveCount(0)

    await expect(page.getByText(/the-long-unbroken-address/)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
