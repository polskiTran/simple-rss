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
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await page.getByRole('link', { name: 'feeds' }).click()
  const control = page.getByRole('textbox', { name: 'add a feed by url' })
  await control.fill(installation.feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
  await control.fill(installation.brokenArticleFeedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'The Quiet Coast' })).toBeVisible()
  await page.getByRole('link', { name: 'digest' }).click()
  await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
}

test.describe('the global search line', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('stays in the chrome across every section and the Reader, saying what it would answer from', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)
    const prompts = {
      digest: 'search your reading',
      feeds: 'search your feeds',
      saved: 'search your saves',
      settings: 'search your reading',
    }

    for (const [section, prompt] of Object.entries(prompts)) {
      await page.getByRole('link', { name: section, exact: true }).click()
      await expect(page.getByRole('searchbox', { name: prompt })).toBeVisible()
    }

    await page.getByRole('link', { name: 'digest', exact: true }).click()
    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'search your reading' })).toBeVisible()
  })

  test('takes slash focus but yields while the User is typing in another field', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })

    await page.getByRole('link', { name: 'settings', exact: true }).click()
    await page.keyboard.press('/')
    await expect(field).toBeFocused()

    await page.getByRole('link', { name: 'feeds', exact: true }).click()
    const feedLine = page.getByRole('textbox', { name: 'add a feed by url' })
    await feedLine.focus()
    await page.keyboard.press('/')
    await expect(feedLine).toBeFocused()
    await expect(feedLine).toHaveValue('/')
  })

  test('uses one results surface, then restores the screen it replaced', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('link', { name: 'settings', exact: true }).click()

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('clear morning')

    await expect(page).toHaveURL(`${installation.url}/search?q=clear+morning`)
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results).toContainText('Field Notes')
    await expect(results).toContainText('today')

    await field.clear()
    await expect(page).toHaveURL(`${installation.url}/settings`)
    await expect(page.getByText('timezone')).toBeVisible()
  })

  test('a result leads back to the search it came from', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('clear morning')
    const results = page.getByRole('region', { name: 'search results' })
    await results.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()

    await page.getByRole('link', { name: '← search' }).click()
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
    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('slow')
    await expect(
      page.getByRole('region', { name: 'search results' }).getByRole('link', { name: 'Slow water' }),
    ).toBeVisible()

    await field.clear()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
    await expect(page).toHaveURL(/\/reader\/\d+$/)
    await expect(page.getByRole('link', { name: '← digest' })).toBeVisible()
  })

  test('backs out to the origin and saves from the results', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('link', { name: 'settings', exact: true }).click()

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('clear morning')
    const save = page.getByRole('button', { name: 'save First light' })
    await save.click()
    await expect(save).toHaveText('saved')

    await page.goBack()
    await expect(page).toHaveURL(`${installation.url}/settings`)
    await expect(field).toHaveValue('')
    await page.getByRole('link', { name: 'saved', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
  })

  test('bounds itself to the opened Feed, and steps out to everywhere', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('link', { name: 'The Quiet Coast' }).click()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)

    await page.getByRole('searchbox', { name: 'search this feed' }).fill('notes')
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()
    await expect(results.getByRole('link', { name: 'The Quiet Coast' })).not.toBeVisible()
    await expect(page.getByText('in The Quiet Coast')).toBeVisible()

    await page.getByRole('link', { name: 'everywhere' }).click()
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(page.getByText('in The Quiet Coast')).not.toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'search your reading' })).toHaveValue('notes')

    await page.goBack()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)
    await expect(page.getByRole('searchbox', { name: 'search this feed' })).toHaveValue('')
  })

  test('shows the matched summary as the grey second line, and no snippet when the title matched', async ({
    page,
    installation,
  }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })
    const results = page.getByRole('region', { name: 'search results' })

    await field.fill('clear morning')
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results.locator('.content-snippet')).toHaveText('A clear morning.')

    await field.fill('first light')
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results.locator('.content-snippet')).toHaveCount(0)
  })

  test('offers a matching Subscription as a jump into its Feed', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('quiet coast')
    const jumpTo = page.getByRole('navigation', { name: 'matching subscriptions' })
    await expect(jumpTo.getByRole('link', { name: 'The Quiet Coast' })).toBeVisible()
    await expect(jumpTo).toContainText('publisher.example')
    await expect(jumpTo.getByRole('img', { name: /items from The Quiet Coast/ })).toBeVisible()

    await jumpTo.getByRole('link', { name: 'The Quiet Coast' }).click()
    await expect(page).toHaveURL(`${installation.url}/feeds/2`)
    await expect(page.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'search this feed' })).toHaveValue('')
  })

  test('matches a Feed title and says plainly when nothing matches', async ({ page, installation }) => {
    await openDigest(page, installation)

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('quiet coast')
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'Slow water' })).toBeVisible()
    await expect(results.getByRole('link', { name: 'First light' })).not.toBeVisible()

    await field.fill('driftwood')
    await expect(page.getByText('nothing in your reading matches “driftwood”')).toBeVisible()

    await field.clear()
    await expect(page.getByRole('heading', { name: 'today · 1 post' })).toBeVisible()
  })
})

test.describe('searching inside the narrow paper', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps a usable line in the narrow chrome', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await expect(field).toBeVisible()
    await expect(field).toBeEditable()

    await field.fill('slow')
    await expect(
      page.getByRole('region', { name: 'search results' }).getByRole('link', { name: 'Slow water' }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
