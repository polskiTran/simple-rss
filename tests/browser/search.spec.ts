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
  const control = page.getByRole('textbox', { name: 'search or add feeds' })
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

  test('stays in the chrome across every section and the Reader', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })

    for (const section of ['digest', 'feeds', 'saved', 'settings']) {
      await page.getByRole('link', { name: section, exact: true }).click()
      await expect(field).toBeVisible()
    }

    await page.getByRole('link', { name: 'digest', exact: true }).click()
    await page.getByRole('link', { name: 'First light' }).click()
    await expect(page.getByRole('heading', { name: 'First light', level: 1 })).toBeVisible()
    await expect(field).toBeVisible()
  })

  test('takes slash focus but yields while the User is typing in another field', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })

    await page.getByRole('link', { name: 'settings', exact: true }).click()
    await page.keyboard.press('/')
    await expect(field).toBeFocused()

    await page.getByRole('link', { name: 'feeds', exact: true }).click()
    const feedLine = page.getByRole('textbox', { name: 'search or add feeds' })
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

    await expect(page).toHaveURL(`${installation.url}/digest`)
    const results = page.getByRole('region', { name: 'search results' })
    await expect(results.getByRole('link', { name: 'First light' })).toBeVisible()
    await expect(results).toContainText('Field Notes')
    await expect(results).toContainText('today')

    await field.clear()
    await expect(page).toHaveURL(`${installation.url}/settings`)
    await expect(page.getByText('timezone')).toBeVisible()
  })

  test('backs out to the origin and saves from the results', async ({ page, installation }) => {
    await openDigest(page, installation)
    await page.getByRole('link', { name: 'saved', exact: true }).click()

    const field = page.getByRole('searchbox', { name: 'search your reading' })
    await field.fill('clear morning')
    const save = page.getByRole('button', { name: 'save First light' })
    await save.click()
    await expect(save).toHaveText('saved')

    await page.goBack()
    await expect(page).toHaveURL(`${installation.url}/saved`)
    await expect(field).toHaveValue('')
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
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

  test('keeps the same usable line in every screen’s chrome', async ({ page, installation }) => {
    await openDigest(page, installation)
    const field = page.getByRole('searchbox', { name: 'search your reading' })

    for (const section of ['digest', 'feeds', 'saved', 'settings']) {
      await page.getByRole('link', { name: section, exact: true }).click()
      await expect(field).toBeVisible()
      await expect(field).toBeEditable()
    }

    await field.fill('slow')
    await expect(
      page.getByRole('region', { name: 'search results' }).getByRole('link', { name: 'Slow water' }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
