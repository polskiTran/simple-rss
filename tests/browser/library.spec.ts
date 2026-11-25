import type { Page } from '@playwright/test'
import { addFeed, claim, expect, expectNoHorizontalOverflow, goTo, test, type Installation } from './installation.js'

async function subscribe(page: Page, installation: Installation): Promise<void> {
  await claim(page, installation.url)
  await addFeed(page, installation.feedUrl)
  await expect(page.getByRole('heading', { level: 1, name: 'Field Notes' })).toBeVisible()
}

const titleIn = (page: Page, title: string) => page.getByRole('main').getByRole('link', { name: title, exact: true })

test.describe('the Library', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('saves from the Digest, keeps it across a reload, and unsaves from the Feed', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')

    await titleIn(page, 'First light').hover()
    const toggle = page.getByRole('button', { name: 'Save First light' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')

    await goTo(page, 'Library')
    await expect(titleIn(page, 'First light')).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Field Notes' })).toBeVisible()
    await expect(page.getByText('1 saved Feed Item')).toBeVisible()

    await page.reload()
    await titleIn(page, 'First light').hover()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')

    await goTo(page, 'Feeds')
    await page.getByRole('main').getByRole('link', { name: 'Field Notes', exact: true }).click()
    const feedToggle = page.getByRole('button', { name: 'Saved First light' })
    await expect(feedToggle).toHaveAttribute('aria-pressed', 'true')
    await feedToggle.click()
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')

    await goTo(page, 'Digest')
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')
    await goTo(page, 'Library')
    await expect(page.getByText(/Nothing saved yet/)).toBeVisible()
  })

  test('shows Save on hover or keyboard focus only, and Saved always', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')

    const save = page.getByRole('button', { name: 'Save First light' })
    await expect(save).toHaveCSS('opacity', '0')
    await titleIn(page, 'First light').hover()
    await expect(save).toHaveCSS('opacity', '1')
    await page.mouse.move(0, 0)
    await expect(save).toHaveCSS('opacity', '0')

    await titleIn(page, 'First light').focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    await expect(save).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')

    const saved = page.getByRole('button', { name: 'Saved First light' })
    await expect(saved).toHaveAttribute('aria-pressed', 'true')
    await page.locator('body').click({ position: { x: 1, y: 700 } })
    await expect(saved).toHaveCSS('opacity', '1')
  })

  test('unsaving in the Library keeps the row with Save, which saves it again', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')
    await titleIn(page, 'First light').hover()
    await page.getByRole('button', { name: 'Save First light' }).click()
    await goTo(page, 'Library')

    await titleIn(page, 'First light').hover()
    await page.getByRole('button', { name: 'Saved First light' }).click()
    await expect(page.getByRole('button', { name: 'Save First light' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(titleIn(page, 'First light')).toBeVisible()
  })

  test('save is keyboard-operable and repeated saves stay one membership', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')

    await titleIn(page, 'First light').focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')

    const membership = await page.evaluate(async () => {
      const digest = await (await fetch('/api/digest', { credentials: 'same-origin' })).json()
      const feedItemId = digest.groups[0].items[0].feedItemId
      const response = await fetch(`/api/library/${feedItemId}`, { method: 'PUT', credentials: 'same-origin' })
      return response.json()
    })
    expect(membership.saved).toBe(true)

    await goTo(page, 'Library')
    await expect(titleIn(page, 'First light')).toHaveCount(1)
  })

  test('opens the Feed a save names, until the save outlives its Subscription', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')
    await titleIn(page, 'First light').hover()
    await page.getByRole('button', { name: 'Save First light' }).click()
    await goTo(page, 'Library')

    await page.getByRole('main').getByRole('link', { name: 'Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds\/\d+$/)
    await expect(page.locator('.x-back')).toHaveText('Library')

    await page.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
    await page.getByRole('button', { name: 'Unsubscribe from Field Notes' }).click()
    await expect(page).toHaveURL(/\/feeds$/)

    await goTo(page, 'Library')
    await expect(page.getByTitle('No longer subscribed')).toHaveText('Field Notes')
    await expect(page.getByRole('main').getByRole('link', { name: 'Field Notes' })).toHaveCount(0)
  })
})

test.describe('the Library at phone width', () => {
  test.use({ viewport: { width: 390, height: 760 } })

  test('keeps a saved row inside the screen', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')
    await titleIn(page, 'First light').click()
    await page.getByRole('button', { name: 'Save First light' }).click()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.x-back').click()

    await goTo(page, 'Library')
    await expect(titleIn(page, 'First light')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('the Library on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('saves from the Reader View, never from the Digest or Library rows', async ({ page, installation }) => {
    await subscribe(page, installation)
    await goTo(page, 'Digest')
    await expect(page.getByRole('button', { name: 'Save First light' })).toBeHidden()

    await titleIn(page, 'First light').tap()
    await page.getByRole('button', { name: 'Save First light' }).tap()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.x-back').tap()

    await goTo(page, 'Library')
    await expect(titleIn(page, 'First light')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Saved First light' })).toBeHidden()
  })
})
