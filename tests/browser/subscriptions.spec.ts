import type { Page } from '@playwright/test'
import { addFeed, claim, expect, expectNoHorizontalOverflow, goTo, test, type Installation } from './installation.js'

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation.url)
  await addFeed(page, installation.feedUrl)
  await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()
}

async function subscribeFromSite(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation.url)
  await goTo(page, 'Feeds')
  await page.getByRole('textbox', { name: 'Add a Feed' }).fill(installation.siteUrl)

  const choices = page.getByRole('group', { name: 'Feeds named by publisher.example' })
  await expect(choices.getByRole('button', { name: 'Field Notes' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('First light')).toBeVisible()
  await choices.getByRole('button', { name: 'Long Meadow' }).click()
  await expect(page.getByText('Meadow note 0', { exact: true })).toBeVisible()
  await expect(page.getByText('First light')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Subscribe to Long Meadow' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Long Meadow' })).toBeVisible()
  await goTo(page, 'Feeds')
  await expect(page.getByRole('main').getByRole('link', { name: 'Long Meadow' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Field Notes' })).toHaveCount(0)
}

async function openFeed(page: Page, title = 'Field Notes'): Promise<void> {
  await goTo(page, 'Feeds')
  await page.getByRole('main').getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

async function expectFeedAndDigest(page: Page, installation: Installation): Promise<void> {
  await subscribe(page, installation)
  await goTo(page, 'Feeds')
  await expect(page.getByRole('main').getByText('publisher.example')).toBeVisible()

  await goTo(page, 'Digest')
  const today = page.getByRole('region', { name: 'Today' })
  await expect(today.getByRole('link', { name: 'First light' })).toBeVisible()
  await expect(today.getByRole('link', { name: 'Field Notes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('main')).not.toContainText(/unread/i)
  await expectNoHorizontalOverflow(page)
}

async function expectOpenFeed(page: Page): Promise<void> {
  await openFeed(page)
  const grid = page.getByRole('group', { name: '26 weeks of Cadence for Field Notes' })
  await expect(grid).toBeVisible()
  await expect(page.locator('.x-back')).toHaveText('Feeds')

  const offScreen = await grid.locator('> *').evaluateAll(
    (cells) =>
      cells.filter((cell) => {
        const box = cell.getBoundingClientRect()
        return box.left < 0 || box.right > window.innerWidth
      }).length,
  )
  expect(offScreen).toBe(0)

  const day = grid.getByRole('button')
  await expect(day).toHaveCount(1)
  await day.press('Enter')
  await expect(page.getByRole('region', { name: 'Today' })).toBeFocused()
  await expect(page.getByRole('region', { name: 'Today' }).getByText('07:15')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const interval = page.getByRole('group', { name: 'Polling interval' })
  await expect(interval.getByRole('button', { name: '2 hours', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await interval.getByRole('button', { name: '6 hours', exact: true }).click()
  await expect(interval.getByRole('button', { name: '6 hours', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const refresh = page.getByRole('button', { name: 'Refresh now' })
  await refresh.click()
  await expect(page.getByText('Refreshed. The Feed shows 1 Feed Item.')).toBeVisible()
  await page.getByRole('button', { name: 'Refresh now' }).click()
  await expect(page.getByText('Checked a moment ago. Wait a little before retrying.')).toBeVisible()

  await page.locator('.x-back').click()
  await expect(page).toHaveURL(/\/feeds$/)
}

test.describe('desktop Feeds and Feed', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('lists the Feed with its site and shows its Feed Item in the Digest', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
  })

  test('subscribes to the Feed chosen from those a site declares', async ({ page, installation }) => {
    await subscribeFromSite(page, installation)
  })

  test('opens one Feed into its Cadence and manages it there', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expectOpenFeed(page)
  })

  test('changes the Reading Source by keyboard and keeps the server’s choice when the Feed is reopened', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await openFeed(page)

    const choice = page.getByRole('group', { name: 'Reading Source' })
    const original = choice.getByRole('button', { name: 'Original webpage' })
    await expect(original).toHaveAttribute('aria-pressed', 'true')
    await original.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')

    await expect(choice.getByRole('button', { name: 'Feed content' })).toHaveAttribute('aria-pressed', 'true')
    await openFeed(page)
    await expect(
      page.getByRole('group', { name: 'Reading Source' }).getByRole('button', { name: 'Feed content' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('sets a custom name and description, and clearing them restores the reported values', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await openFeed(page)
    await expect(page.getByText('Notes from the field.')).toBeVisible()
    await page.getByRole('button', { name: 'Edit name and description' }).click()

    const name = page.getByRole('textbox', { name: 'Name' })
    const description = page.getByRole('textbox', { name: 'Description' })
    await expect(name).toHaveAttribute('placeholder', 'Field Notes')
    await expect(description).toHaveAttribute('placeholder', 'Notes from the field.')
    await expect(name).toHaveAttribute('maxlength', '512')
    await expect(description).toHaveAttribute('maxlength', '1024')
    await name.fill('Tech tabloid')
    await description.fill('read weekly')
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Tech tabloid' })).toBeVisible()
    await expect(page.getByText('read weekly')).toBeVisible()
    await openFeed(page, 'Tech tabloid')

    await page.getByRole('button', { name: 'Edit name and description' }).click()
    await expect(name).toHaveValue('Tech tabloid')
    await expect(description).toHaveValue('read weekly')
    await name.fill('')
    await description.fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()
    await expect(page.getByText('Notes from the field.')).toBeVisible()
  })

  test('asks before unsubscribing, then leaves for an empty Feeds list', async ({ page, installation }) => {
    await subscribe(page, installation)
    await openFeed(page)
    await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click()

    await expect(page.getByText('Its Feed Items leave the Digest. Saved ones stay in the Library.')).toBeVisible()
    await page.getByRole('button', { name: 'Unsubscribe from Field Notes' }).click()

    await expect(page).toHaveURL(/\/feeds$/)
    await expect(page.getByText('No Feeds yet.')).toBeVisible()
  })
})

test.describe('phone Feeds and Feed', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the same structure on the phone screen, Settings in the top bar', async ({ page, installation }) => {
    await expectFeedAndDigest(page, installation)
    const settings = await page.getByRole('link', { name: 'Settings', exact: true }).boundingBox()
    expect(settings?.y).toBeLessThan(60)
  })

  test('subscribes to the Feed chosen from those a site declares', async ({ page, installation }) => {
    await subscribeFromSite(page, installation)
  })

  test('keeps the whole Cadence selectable on the phone screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expectOpenFeed(page)
  })
})

test.describe('an opened Feed on the narrowest phone', () => {
  test.use({ viewport: { width: 320, height: 640 } })

  test('fits its actions and its Cadence inside the screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await expect(page.getByRole('group', { name: '26 weeks of Cadence for Field Notes' })).toBeVisible()

    await expect(page.getByRole('button', { name: 'Unsubscribe', exact: true })).toBeInViewport({ ratio: 1 })
    await expectNoHorizontalOverflow(page)
  })
})
