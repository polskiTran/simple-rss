import type { Page } from '@playwright/test'
import {
  expect,
  expectNoHorizontalOverflow,
  USER_PASSWORD,
  SETUP_SECRET,
  test,
  type Installation,
} from './installation.js'

const LIGHT_ACCENT = 'rgb(36, 56, 216)'
const QUIET_GREY = 'rgb(163, 162, 157)'

/** Claims the installation and subscribes to the fixture Feed, ending on Feeds. */
async function subscribe(page: Page, installation: Installation): Promise<void> {
  await page.goto(installation.url)
  await page.getByLabel('setup secret').fill(SETUP_SECRET)
  await page.getByLabel('password', { exact: true }).fill(USER_PASSWORD)
  await page.getByLabel('confirm password').fill(USER_PASSWORD)
  await page.getByRole('button', { name: 'claim' }).click()
  await page.getByRole('link', { name: 'feeds' }).click()
  await page.getByRole('textbox', { name: 'search or add feeds' }).fill(installation.feedUrl)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Field Notes' })).toBeVisible()
}

test.describe('the Library', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('saves from the Digest, keeps it across contexts and a reload, and unsaves', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    // The affordance is a word in the quietest grey; saving turns it into
    // `saved` in the one accent the design reserves — in place, no icon.
    const toggle = page.getByRole('button', { name: 'save First light' })
    await expect(toggle).toHaveText('save')
    await expect(toggle).toHaveCSS('color', QUIET_GREY)
    await toggle.click()
    await expect(toggle).toHaveText('saved')
    await expect(toggle).toHaveCSS('color', LIGHT_ACCENT)

    // The Saved tab lists it in the shared shape, with its source.
    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.locator('.content-meta')).toContainText('Field Notes')
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('saved')

    // Membership is the server's, so a fresh load still knows.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'First light' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('saved')

    // The opened Feed agrees, and can unsave from its own row.
    await page.getByRole('link', { name: 'feeds' }).click()
    await page.getByRole('link', { name: 'Field Notes' }).click()
    const feedToggle = page.getByRole('button', { name: 'save First light' })
    await expect(feedToggle).toHaveText('saved')
    await feedToggle.click()
    await expect(feedToggle).toHaveText('save')

    // Unsaved everywhere: the Digest offers `save` again, the Library is empty.
    await page.getByRole('link', { name: 'digest' }).click()
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('save')
    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByText(/nothing saved yet/)).toBeVisible()
  })

  test('save is keyboard-operable and repeated saves stay one membership', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()

    const toggle = page.getByRole('button', { name: 'save First light' })
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveText('saved')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // A second device saving again — modeled by the API directly — answers
    // with the same membership rather than a duplicate.
    const membership = await page.evaluate(async () => {
      const digest = await (await fetch('/api/digest', { credentials: 'same-origin' })).json()
      const feedItemId = digest.groups[0].items[0].feedItemId
      const response = await fetch(`/api/library/${feedItemId}`, {
        method: 'PUT',
        credentials: 'same-origin',
      })
      return response.json()
    })
    expect(membership.saved).toBe(true)

    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByRole('heading', { name: 'First light' })).toHaveCount(1)
  })

  test('opens the Feed a save names, until the save outlives its Subscription', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('button', { name: 'save First light' }).click()
    await page.getByRole('link', { name: 'saved' }).click()

    // While the Subscription stands, the attribution opens the Feed, which
    // goes back to the saves it was opened from.
    await page.locator('.content-meta').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await expect(page.getByRole('link', { name: '← saved' })).toBeVisible()

    // Unsubscribing keeps the save but removes what its attribution pointed at.
    await page.getByRole('button', { name: 'unsubscribe…' }).click()
    await page.getByRole('button', { name: 'unsubscribe', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'search or add feeds' })).toBeVisible()

    await page.getByRole('link', { name: 'saved' }).click()
    await expect(page.getByText('Field Notes · no longer subscribed')).toBeVisible()
    await expect(page.getByRole('link', { name: /Field Notes/ })).toHaveCount(0)
  })
})

test.describe('the Library inside the narrow paper', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps the shared shape and spacing without horizontal overflow', async ({
    page,
    installation,
  }) => {
    await subscribe(page, installation)
    await page.getByRole('link', { name: 'digest' }).click()
    await page.getByRole('button', { name: 'save First light' }).click()
    await expect(page.getByRole('button', { name: 'save First light' })).toHaveText('saved')

    await page.getByRole('link', { name: 'saved' }).click()
    const title = page.getByRole('heading', { name: 'First light' })
    await expect(title).toBeVisible()
    // The one shape, at its narrow scale: 19px titles, 12px meta.
    await expect(title).toHaveCSS('font-size', '19px')
    await expect(page.locator('.content-meta')).toHaveCSS('font-size', '12px')
    await expectNoHorizontalOverflow(page)
  })
})
