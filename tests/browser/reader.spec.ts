import type { Page } from '@playwright/test'
import { expect, OWNER_PASSWORD, SETUP_SECRET, test, type Installation } from './installation.js'

/** Claims the installation and subscribes to the fixture Feed, ending on Feeds. */
async function subscribe(page: Page, installation: Installation, feedUrl = installation.feedUrl): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(OWNER_PASSWORD)
  await page.getByLabel('confirm password').fill(OWNER_PASSWORD)
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

  test('opens from the Digest, reads clean structured content, and returns', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page).toHaveURL(/\/reader\/\d+$/)

    // The accepted layout: title, Feed, date, reading time, save, original.
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    const meta = page.locator('.reader-meta')
    await expect(meta).toContainText('Field Notes')
    await expect(meta).toContainText(/\d+ min/)
    const original = page.getByRole('link', { name: 'open original' })
    await expect(original).toHaveAttribute('href', 'https://publisher.example/first-light')
    await expect(original).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(original).toHaveAttribute('target', '_blank')

    // Structure survives: headings, lists, code.
    await expect(page.getByRole('heading', { name: 'Field methods' })).toBeVisible()
    await expect(page.getByText('arrive before the light')).toBeVisible()
    await expect(page.locator('.article-body pre code')).toContainText('def observe()')

    // The hostile parts do not: no script effect, no frames, no forms.
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()
    expect(await page.locator('.article-body iframe, .article-body form, .article-body script').count()).toBe(0)
    await expect(page.getByText('Subscribe now')).toHaveCount(0)

    // Article links leave for the publisher, resolved and marked external.
    const noteLink = page.getByRole('link', { name: /the notebook/ })
    await expect(noteLink).toHaveAttribute('href', 'https://publisher.example/notes')
    await expect(noteLink).toHaveAttribute('rel', 'noopener noreferrer')

    // A reload lands straight back in the article — the route is real.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'First light' })).toBeVisible()

    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('heading', { name: /today · 1 post/ })).toBeVisible()
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

  test('falls back to the summary with a rate-limited retry when parsing fails', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation, installation.brokenArticleFeedUrl)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('link', { name: 'Slow water' }).click()

    // The Feed Item is untouched: its stored summary and the way out. The
    // meta row and the fallback each offer the original, so two links match.
    await expect(page.getByRole('heading', { level: 1, name: 'Slow water' })).toBeVisible()
    await expect(page.getByText('Tide notes from the shore.')).toBeVisible()
    const originals = page.getByRole('link', { name: 'open original' })
    await expect(originals).toHaveCount(2)
    await expect(originals.first()).toHaveAttribute('href', 'https://publisher.example/slow-water')

    // The offered retry is honest: the first click really tries again and,
    // with the publisher still down, lands back on the same calm fallback.
    await page.getByRole('button', { name: 'retry parsing' }).click()
    await expect(page.getByText('Tide notes from the shore.')).toBeVisible()
    await expect(page.getByText(/wait \d+s, then retry/)).toHaveCount(0)

    // Hammering it is not: the next attempt inside the cooldown is refused
    // with the wait rather than another retrieval.
    await page.getByRole('button', { name: 'retry parsing' }).click()
    await expect(page.getByText(/wait \d+s, then retry/)).toBeVisible()

    // Nothing about the item changed: still in the Digest, still unsaved.
    await page.getByRole('link', { name: '← digest' }).click()
    await expect(page.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'save Slow water' })).toHaveText('save')
  })

  test('never dead-ends: next in the digest walks to the following item', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await subscribeTo(page, installation.brokenArticleFeedUrl)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('link', { name: 'First light' }).click()

    await expect(page.getByText('next in the digest')).toBeVisible()
    await page.getByRole('link', { name: 'Slow water' }).click()

    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Slow water' })).toBeVisible()
    // The last item in the Digest ends calmly instead of pointing onward.
    await expect(page.getByText('next in the digest')).toHaveCount(0)
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

    // Nothing forces the page wider than the phone: reading needs no panning.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})
