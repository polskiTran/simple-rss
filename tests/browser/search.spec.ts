import type { Page } from '@playwright/test'
import { addFeed, claim, expect, expectNoHorizontalOverflow, goTo, test, type Installation } from './installation.js'

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation.url)
  await addFeed(page, installation.feedUrl)
  await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()
  await addFeed(page, installation.brokenArticleFeedUrl)
  await expect(page.getByRole('heading', { level: 1, name: 'The Quiet Coast' })).toBeVisible()
  await goTo(page, 'Digest')
  await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible()
}

async function search(page: Page, words: string, prompt = 'Search your reading'): Promise<void> {
  const field = page.getByRole('searchbox', { name: prompt })
  await field.fill(words)
  await field.press('Enter')
}

const results = (page: Page) => page.getByRole('region', { name: 'Search results' })

test.describe('the search line', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('stays in the top bar on every screen, saying what it would answer from', async ({ page, installation }) => {
    await openDigest(page, installation)
    const prompts = {
      Digest: 'Search your reading',
      Feeds: 'Search your feeds',
      Library: 'Search your saves',
      Settings: 'Search your reading',
    } as const

    for (const [place, prompt] of Object.entries(prompts)) {
      await goTo(page, place as keyof typeof prompts)
      await expect(page.getByRole('searchbox', { name: prompt })).toBeVisible()
    }

    await goTo(page, 'Digest')
    await page.getByRole('main').getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search your reading' })).toBeVisible()
  })

  test('takes slash focus but yields while the User is typing in another field', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'Search your reading' })

    await goTo(page, 'Settings')
    await page.keyboard.press('/')
    await expect(field).toBeFocused()

    await goTo(page, 'Feeds')
    const address = page.getByRole('textbox', { name: 'Site or Feed address' })
    await address.focus()
    await page.keyboard.press('/')
    await expect(address).toBeFocused()
    await expect(address).toHaveValue('/')
  })

  test('answers on its own screen, and Back returns to the screen it was asked from', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)
    await goTo(page, 'Settings')

    await search(page, 'clear morning')

    await expect(page).toHaveURL(`${installation.url}/search?q=clear+morning`)
    const fieldNotes = results(page).getByRole('region', { name: 'Field Notes' })
    await expect(fieldNotes.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(fieldNotes).toContainText('Today')

    await page.goBack()
    await expect(page).toHaveURL(`${installation.url}/settings`)
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible()
  })

  test('a result leads back to the search it came from', async ({ page, installation }) => {
    await openDigest(page, installation)
    await search(page, 'clear morning')
    await results(page).getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()

    await expect(page.locator('.x-back')).toHaveText('Search')
    await page.locator('.x-back').click()
    await expect(results(page).getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search your reading' })).toHaveValue('clear morning')
  })

  test('saves from the results, and the Library agrees', async ({ page, installation }) => {
    await openDigest(page, installation)
    await search(page, 'clear morning')

    await results(page).getByRole('link', { name: 'First light' }).hover()
    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')

    await goTo(page, 'Library')
    await expect(page.getByRole('main').getByRole('link', { name: 'First light' })).toBeVisible()
  })

  test('scopes itself to the opened Feed, and steps out to everywhere and back', async ({ page, installation }) => {
    await openDigest(page, installation)
    await goTo(page, 'Feeds')
    await page.getByRole('main').getByRole('link', { name: 'The Quiet Coast' }).click()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)

    await search(page, 'notes', 'Search this feed')
    const scopes = page.getByRole('group', { name: 'Search in' })
    await expect(page).toHaveURL(`${installation.url}/search?q=notes&feed=2`)
    await expect(results(page).getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results(page).getByRole('link', { name: 'First light' })).toHaveCount(0)
    await expect(scopes.getByRole('button', { name: 'The Quiet Coast' })).toHaveAttribute('aria-pressed', 'true')

    await scopes.getByRole('button', { name: 'Everywhere' }).click()
    await expect(page).toHaveURL(`${installation.url}/search?q=notes`)
    await expect(results(page).getByRole('link', { name: 'First light' })).toBeVisible()

    await scopes.getByRole('button', { name: 'This Feed' }).click()
    await expect(page).toHaveURL(`${installation.url}/search?q=notes&feed=2`)
    await expect(results(page).getByRole('link', { name: 'First light' })).toHaveCount(0)
  })

  test('narrows a search of everything to one Feed from its group', async ({ page, installation }) => {
    await openDigest(page, installation)
    await search(page, 'notes')

    const coast = results(page).getByRole('region', { name: 'The Quiet Coast' })
    await coast.getByRole('button', { name: 'Search only here' }).click()

    await expect(page).toHaveURL(`${installation.url}/search?q=notes&feed=2`)
    await expect(results(page).getByRole('link', { name: 'First light' })).toHaveCount(0)
  })

  test('marks the words the index matched in the snippet, and gives no snippet when the title matched', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)

    await search(page, 'clear morn')
    await expect(results(page).getByRole('link', { name: 'First light' })).toBeVisible()
    const snippet = results(page).locator('.x-search-snippet')
    await expect(snippet).toHaveText('A clear morning.')
    await expect(snippet.locator('mark')).toHaveText(['clear', 'morning'])

    await search(page, 'first light')
    await expect(results(page).getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results(page).locator('.x-search-snippet')).toHaveCount(0)
  })

  test('offers a Subscription whose name matches as a way into its Feed', async ({ page, installation }) => {
    await openDigest(page, installation)

    await search(page, 'quiet coast')
    const feeds = results(page).getByRole('region', { name: 'Feeds' })
    await expect(feeds).toContainText('publisher.example')

    await feeds.getByRole('link', { name: 'The Quiet Coast' }).click()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)
    await expect(page.getByRole('main').getByRole('link', { name: 'Slow water' })).toBeVisible()
  })

  test('matches a Feed title and says plainly when nothing matches', async ({ page, installation }) => {
    await openDigest(page, installation)

    await search(page, 'quiet coast')
    await expect(results(page).getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results(page).getByRole('link', { name: 'First light' })).toHaveCount(0)

    await search(page, 'driftwood')
    await expect(page.getByText('Nothing in your reading matches.')).toBeVisible()
  })
})

test.describe('searching on the narrowest phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })

  test('answers inside the screen', async ({ page, installation }) => {
    await openDigest(page, installation)

    await search(page, 'notes')
    await expect(results(page).getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
