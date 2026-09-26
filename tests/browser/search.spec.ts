import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

async function openDigest(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('Setup secret').fill(SETUP_SECRET)
  await page.getByLabel('Password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('Confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'Claim installation' }).click()
  await section(page, 'Feeds').click()
  await addFeed(page, installation.feedUrl)
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
  await addFeed(page, installation.brokenArticleFeedUrl)
  await expect(page.getByRole('heading', { name: 'The Quiet Coast' })).toBeVisible()
  await section(page, 'Digest').click()
  await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
}

async function addFeed(page: Page, feedUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Add feed' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill(feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** A section's link in the chrome; exact, since a back button names the same section. */
function section(page: Page, name: 'Digest' | 'Feeds' | 'Saved' | 'Settings') {
  return page.getByRole('link', { name, exact: true })
}

test.describe('the global search line', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('stays in the chrome across every section and the Reader, saying what it would answer from', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)
    const prompts = {
      Digest: 'Search your reading',
      Feeds: 'Search your feeds',
      Saved: 'Search your saves',
      Settings: 'Search your reading',
    } as const

    for (const [name, prompt] of Object.entries(prompts)) {
      await section(page, name as keyof typeof prompts).click()
      await expect(page.getByRole('searchbox', { name: prompt })).toBeVisible()
    }

    await section(page, 'Digest').click()
    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search your reading' })).toBeVisible()
  })

  test('takes slash focus but yields while the User is typing in another field', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'Search your reading' })

    await section(page, 'Settings').click()
    await page.keyboard.press('/')
    await expect(field).toBeFocused()

    await section(page, 'Feeds').click()
    await page.getByRole('button', { name: 'Add feed' }).click()
    const address = page.getByRole('textbox', { name: 'URL' })
    await address.focus()
    await page.keyboard.press('/')
    await expect(address).toBeFocused()
    await expect(address).toHaveValue('/')
  })

  test('uses one results surface, then restores the screen it replaced', async ({ page, installation }) => {
    await openDigest(page, installation)
    await section(page, 'Settings').click()

    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await field.fill('clear morning')

    await expect(page).toHaveURL(`${installation.url}/search?q=clear+morning`)
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results).toContainText('Field Notes')
    await expect(results).toContainText('Today')

    await field.clear()
    await expect(page).toHaveURL(`${installation.url}/settings`)
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  })

  test('a result leads back to the search it came from', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await field.fill('clear morning')
    const results = page.getByRole('region', { name: 'search results' })
    await results.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()

    await page.getByRole('link', { name: 'Back to Search' }).click()
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(field).toHaveValue('clear morning')
  })

  test('clearing a search launched from the Reader restores the article, trail intact', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)
    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()

    await page.keyboard.press('/')
    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await expect(field).toBeFocused()
    await field.fill('slow')
    await expect(
      page.getByRole('region', { name: 'search results' }).getByRole('link', { name: 'Slow water' }),
    ).toBeVisible()

    await field.clear()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await expect(page.getByRole('link', { name: 'Back to Digest' })).toBeVisible()
  })

  test('backs out to the origin and saves from the results', async ({ page, installation }) => {
    await openDigest(page, installation)
    await section(page, 'Settings').click()

    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await field.fill('clear morning')
    const save = page.getByRole('button', { name: 'Save First light' })
    await save.click()
    await expect(save).toHaveAttribute('aria-pressed', 'true')

    await page.goBack()
    await expect(page).toHaveURL(`${installation.url}/settings`)
    await expect(field).toHaveValue('')
    await section(page, 'Saved').click()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
  })

  test('scopes itself to the opened Feed, and steps out to everywhere', async ({ page, installation }) => {
    await openDigest(page, installation)
    await section(page, 'Feeds').click()
    await page.getByRole('link', { name: 'The Quiet Coast' }).click()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)

    await page.getByRole('searchbox', { name: 'Search this feed' }).fill('notes')
    const results = page.getByRole('region', { name: 'search results' })
    const scopes = page.getByRole('group', { name: 'Search in' })
    await expect(page).toHaveURL(`${installation.url}/search?q=notes&feed=2`)
    await expect(results.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()
    await expect(results.getByRole('link', { name: 'The Quiet Coast' })).not.toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('in The Quiet Coast')
    await expect(scopes.getByRole('button', { name: 'This feed' })).toHaveAttribute('aria-pressed', 'true')

    await scopes.getByRole('button', { name: 'Everywhere' }).click()
    await expect(page).toHaveURL(`${installation.url}/search?q=notes`)
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('in The Quiet Coast')
    await expect(page.getByRole('searchbox', { name: 'Search your reading' })).toHaveValue('notes')

    await scopes.getByRole('button', { name: 'This feed' }).click()
    await expect(page).toHaveURL(`${installation.url}/search?q=notes&feed=2`)
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)
    await expect(page.getByRole('searchbox', { name: 'Search this feed' })).toHaveValue('')
  })

  test('shows the matched summary with its words marked, and no snippet when the title matched', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    const results = page.getByRole('region', { name: 'search results' })

    await field.fill('clear morning')
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    const snippet = results.locator('.item-snippet')
    await expect(snippet).toHaveText('A clear morning.')
    await expect(snippet.locator('mark.match')).toHaveText(['clear', 'morning'])

    await field.fill('first light')
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results.locator('.item-snippet')).toHaveCount(0)
  })

  test('offers a matching Subscription as a jump into its Feed', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await field.fill('quiet coast')
    const jumpTo = page.getByRole('navigation', { name: 'matching subscriptions' })
    await expect(jumpTo.getByRole('link', { name: 'The Quiet Coast' })).toBeVisible()
    await expect(jumpTo).toContainText('publisher.example')
    await expect(jumpTo.getByRole('img', { name: /items from The Quiet Coast/ })).toBeVisible()

    await jumpTo.getByRole('link', { name: 'The Quiet Coast' }).click()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)
    await expect(page.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search this feed' })).toHaveValue('')
  })

  test('matches a Feed title and says plainly when nothing matches', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await field.fill('quiet coast')
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()

    await field.fill('driftwood')
    await expect(page.getByText('Nothing in your reading matches “driftwood”.')).toBeVisible()

    await field.clear()
    await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
  })
})

test.describe('searching at phone width', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('opens the field from its square, and the close square leaves the search', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'Search your reading' })
    await expect(field).not.toBeVisible()

    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(field).toBeFocused()

    await field.fill('slow')
    await expect(
      page.getByRole('region', { name: 'search results' }).getByRole('link', { name: 'Slow water' }),
    ).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Sections' })).not.toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'Close search' }).click()
    await expect(page).toHaveURL(`${installation.url}/digest`)
    await expect(field).not.toBeVisible()
    await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible()
  })
})
